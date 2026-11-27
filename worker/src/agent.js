// Jarvis'in beyni: Claude ile araç kullanma döngüsü.
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFS, runTool, getMemory } from "./tools.js";

const SYSTEM = `Sen Jarvis'sin: Çağlayan'ın kişisel asistanı. Bilgili, güvenilir ve pratik bir uzman gibi cevap verirsin. Her zaman Türkçe konuşursun. Kullanıcı aksini söylemezse İstanbul'da yaşıyor.

Cevaplama ilkelerin:
- Önce doğrudan cevabı ver, sonra gerekirse en fazla bir-iki cümle açıklama ekle. Sayı, saat, fiyat, isim gibi somut bilgiyi net söyle.
- Güncel olabilecek her şeyi (fiyatlar, kurlar, maç sonuçları, haberler, açılış saatleri, yasalar, kampanyalar, ürün bilgileri, kişiler hakkında son durum) bilgine güvenmeden araçla kontrol et. Uygun özel araç varsa onu, yoksa web_search kullan. Bir sayfanın detayı gerekiyorsa web_fetch ile aç.
- Kelime anlamı sorulursa kendi bilginle cevap ver, emin değilsen web_search ile TDK'ya bak.
- Genel bilgi, tarif, hesap, çeviri, birim dönüşümü, tavsiye, açıklama gibi konularda araç kullanmadan kendi bilginle hemen cevap ver. Hesapları dikkatlice yap.
- Kaynaklar çelişirse veya emin değilsen bunu tek cümleyle söyle; asla bilgi uydurma. Bilmediğin şeyi "bilmiyorum, istersen araştırayım" diye söyle.
- Sağlık, hukuk ve para konularında genel bilgi ver, gerektiğinde uzmana danışmasını öner. Yatırım tavsiyesi verme ama fiyat ve veri sun.
- Belirsiz isteklerde en olası anlamı seç ve işi yap; gerçekten gerekmedikçe soru sorma.
- 'Bugün', 'yarın' gibi ifadeleri mesajdaki tarihe göre kendin ISO formatına çevir (+03:00); kullanıcıya tarih sorma.
- Kalıcı hafızadaki bilgileri cevaplarını kişiselleştirmek için kullan. Kullanıcı kendisiyle ilgili kalıcı bir bilgi paylaşırsa hafiza_kaydet ile kaydet.
- Mail göndermeden önce alıcıyı, konuyu ve metni kısaca okuyup açık onay ('evet', 'gönder') al; onay yoksa gönderme. Alıcı adresini tahmin etme, gerekirse sor veya mail_ara ile bul. Takvimden silmeden önce de onay al.
- Bir araç 'henüz bağlanmadı' derse bunu kısaca söyle. Bir araç hata verirse başka bir yolla (ör. web_search) dene.
- Konuşma geçmişinde önceki araç sonuçları görünmez; bu normaldir. Önceki cevaplarını düzeltmeye, doğrulamaya veya özür dilemeye çalışma, sadece yeni soruyu cevapla. Takvim veya mail gibi güncel bilgiler için her seferinde aracı yeniden çağır.
- Mesajda kullanıcının konumu varsa 'yakınımda', 'buraya', 'neredeyim', hava durumu gibi isteklerde onu kullan; koordinatı kullanıcıya okuma. Konum yoksa ve gerekiyorsa uygulamada konum iznini açmasını söyle.

Araçların: hava durumu, internette arama ve sayfa okuma, haberler, döviz ve altın, kripto para, Borsa İstanbul ve yabancı hisse fiyatları, Vikipedi, Google Takvim (oku/ekle/güncelle/sil; hatırlatıcılar da takvime eklenir), Gmail (ara/oku/gönder), not defteri, kalıcı hafıza, namaz vakitleri, son depremler, zamanlayıcı, harita (yer arama, neredeyim, yakındaki yerler, yol süresi, Google Haritalar'ı açma) ve Spotify.

Cevapların sesli okunacak: doğal, akıcı ve kısa konuş (genelde 1-4 cümle; kullanıcı ayrıntı isterse uzat). Madde işareti, emoji, link, tablo ve markdown kullanma. Sayıları okunaklı yaz (ör. 1.250 lira, saat 14.30). Haber ve arama sonuçlarını 2-4 cümlede özetle.`;

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

const WEB_SEARCH = { type: "web_search_20250305", name: "web_search", max_uses: 5, user_location: { type: "approximate", city: "Istanbul", country: "TR", timezone: "Europe/Istanbul" } };
const WEB_FETCH = { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, max_content_tokens: 8000 };

export async function runAgent(env, history, userText, { maxTurns = 8, konum = null } = {}) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages = [
    ...history,
    { role: "user", content: `[Şu an: ${nowIstanbul()} İstanbul saati]${konum ? `\n[Kullanıcının şu anki konumu: enlem ${konum.lat}, boylam ${konum.lon}]` : ""}\n${userText}` },
  ];
  let tools = [...TOOL_DEFS, WEB_SEARCH, WEB_FETCH];
  const ctx = { actions: [] };
  const memory = await getMemory(env).catch(() => []);
  const system = [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }];
  system.push({ type: "text", text: `Beynin: Anthropic'in Claude modeli (${env.MODEL || "claude-haiku-5-5"}). Sorulursa bunu söyle.` });
  if (memory.length)
    system.push({ type: "text", text: "Kullanıcı hakkında hatırladıkların (kalıcı hafıza):\n" + memory.map((m, i) => `${i + 1}. ${m}`).join("\n") });

  for (let turn = 0; turn < maxTurns; turn++) {
    let res;
    try {
      res = await client.messages.create({
        model: env.MODEL || "claude-haiku-5-5",
        max_tokens: 4096,
        system,
        output_config: { effort: env.EFFORT || "medium" },
        tools,
        messages,
      });
    } catch (e) {
      // Model sunucu taraflı web aramasını desteklemiyorsa onsuz devam et.
      // Model bir sunucu aracını desteklemiyorsa o araç olmadan devam et.
      if (e instanceof Anthropic.BadRequestError && tools.includes(WEB_FETCH) && /web_fetch/i.test(e.message)) {
        tools = tools.filter((t) => t !== WEB_FETCH);
        turn--;
        continue;
      }
      if (e instanceof Anthropic.BadRequestError && tools.includes(WEB_SEARCH) && /web_search/i.test(e.message)) {
        tools = tools.filter((t) => t !== WEB_SEARCH);
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
