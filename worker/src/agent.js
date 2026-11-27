// Jarvis'in beyni: Claude ile araç kullanma döngüsü.
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFS, runTool, getMemory } from "./tools.js";

const SYSTEM = `Sen Çağlayan'ın kişisel asistanı Jarvis'sin. Her zaman Türkçe, kısa ve samimi cevap ver. Kullanıcı aksini söylemezse İstanbul'da yaşıyor.

Araçların: hava durumu, internette arama (web_search), haberler, döviz ve altın, Vikipedi, Google Takvim (oku/ekle/güncelle/sil; hatırlatıcılar da takvime eklenir), Gmail (ara/oku/gönder), not defteri (ekle/oku/sil), kalıcı hafıza (kullanıcı hakkında bilgiler), namaz vakitleri, son depremler, zamanlayıcı, harita (yer arama, neredeyim, yakındaki eczane/benzinlik vb., yol süresi, Google Haritalar'ı açma) ve Spotify (çal, durdur, devam, sonraki, önceki, ses, şu an çalan).
- 'Bugün', 'yarın' gibi ifadeleri mesajdaki tarihe göre kendin ISO formatına çevir (+03:00); kullanıcıya tarih sorma.
- Bir istek araçlarla yapılabiliyorsa hemen aracı kullan, gereksiz soru sorma. Araç sonucundan emin değilsen uydurma.
- Mail göndermeden önce alıcıyı, konuyu ve metni kısaca okuyup açık onay ('evet', 'gönder') al; onay yoksa gönderme. Alıcı adresini tahmin etme, gerekirse sor veya mail_ara ile bul.
- Bir araç 'henüz bağlanmadı' derse bunu kısaca söyle.
- Mesajda kullanıcının konumu varsa 'yakınımda', 'buraya', 'neredeyim', hava durumu gibi isteklerde onu kullan; koordinatı kullanıcıya okuma. Konum yoksa ve gerekiyorsa uygulamada konum iznini açmasını söyle.

Cevapların sesli okunacak: kısa ve doğal konuş; madde işareti, emoji, link ve markdown kullanma. Haber ve arama sonuçlarını 2-4 cümlede özetle.`;

function nowIstanbul() {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

const WEB_SEARCH = { type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", city: "Istanbul", country: "TR", timezone: "Europe/Istanbul" } };

export async function runAgent(env, history, userText, { maxTurns = 8, konum = null } = {}) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages = [
    ...history,
    { role: "user", content: `[Şu an: ${nowIstanbul()} İstanbul saati]${konum ? `\n[Kullanıcının şu anki konumu: enlem ${konum.lat}, boylam ${konum.lon}]` : ""}\n${userText}` },
  ];
  let tools = [...TOOL_DEFS, WEB_SEARCH];
  const ctx = { actions: [] };
  const memory = await getMemory(env).catch(() => []);
  const system = [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }];
  if (memory.length)
    system.push({ type: "text", text: "Kullanıcı hakkında hatırladıkların (kalıcı hafıza):\n" + memory.map((m, i) => `${i + 1}. ${m}`).join("\n") });

  for (let turn = 0; turn < maxTurns; turn++) {
    let res;
    try {
      res = await client.messages.create({
        model: env.MODEL || "claude-haiku-5-5",
        max_tokens: 4096,
        system,
        output_config: { effort: "low" },
        tools,
        messages,
      });
    } catch (e) {
      // Model sunucu taraflı web aramasını desteklemiyorsa onsuz devam et.
      if (e instanceof Anthropic.BadRequestError && tools.includes(WEB_SEARCH) && /web_search/i.test(e.message)) {
        tools = TOOL_DEFS;
        turn--;
        continue;
      }
      throw e;
    }

    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use") {
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return { text: text || "Bunu şu an yapamadım.", messages, actions: ctx.actions };
    }

    const calls = res.content.filter((b) => b.type === "tool_use");
    const results = await Promise.all(
      calls.map(async (c) => {
        try {
          const out = await runTool(env, c.name, c.input || {}, ctx);
          return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out).slice(0, 12000) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: c.id, content: String(err.message || err), is_error: true };
        }
      })
    );
    messages.push({ role: "user", content: results });
  }
  return { text: "Bu iş biraz uzun sürdü, tekrar dener misin?", messages, actions: ctx.actions };
}
