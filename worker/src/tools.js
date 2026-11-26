// Jarvis'in araçları: Claude'a tanıtılan tanımlar ve onları çalıştıran kod.
import { calendarList, calendarCreate, gmailSearch, gmailSend } from "./google.js";
import { spotifyPlay, spotifyControl, spotifyNowPlaying } from "./spotify.js";

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  {
    name: "hava_durumu",
    description: "Bir konumun güncel hava durumunu ve 3 günlük tahminini getirir. Enlem/boylamı kendin ver (İstanbul 41.01, 28.98).",
    input_schema: obj({ enlem: { type: "number" }, boylam: { type: "number" } }, ["enlem", "boylam"]),
  },
  {
    name: "haberler",
    description: "Google Haberler'den son 24 saatin Türkçe haber başlıklarını getirir. Genel gündem için konu 'gündem' olsun. Maç skorları ve son olaylar için de kullan.",
    input_schema: obj({ konu: { type: "string" } }, ["konu"]),
  },
  {
    name: "doviz_altin",
    description: "Güncel dolar, euro, sterlin, altın (gram, çeyrek, yarım, tam, cumhuriyet, ons) ve gümüş fiyatlarını TL olarak getirir.",
    input_schema: obj({}),
  },
  {
    name: "wikipedia",
    description: "Türkçe Vikipedi'de bir konunun özetini getirir.",
    input_schema: obj({ konu: { type: "string" } }, ["konu"]),
  },
  {
    name: "takvim_oku",
    description: "Google Takvim'deki etkinlikleri listeler. Zamanlar ISO 8601, +03:00 ile.",
    input_schema: obj({ baslangic: { type: "string" }, bitis: { type: "string" } }, ["baslangic", "bitis"]),
  },
  {
    name: "takvim_ekle",
    description: "Google Takvim'e etkinlik ekler. Hatırlatıcı istenirse o saatte 15 dakikalık 'Hatırlatma: ...' etkinliği ekle ve hatirlatma_dakika=0 ver; telefona bildirim gelir.",
    input_schema: obj(
      {
        baslik: { type: "string" },
        baslangic: { type: "string", description: "ISO 8601, +03:00" },
        bitis: { type: "string", description: "ISO 8601, +03:00" },
        aciklama: { type: "string" },
        hatirlatma_dakika: { type: "number", description: "Kaç dakika önce bildirim gelsin" },
      },
      ["baslik", "baslangic", "bitis"]
    ),
  },
  {
    name: "mail_ara",
    description: "Gmail'de mail arar ve kimden/konu/özet döndürür. Gmail arama sözdizimi kullan (örn. 'is:unread newer_than:1d', 'from:ali').",
    input_schema: obj({ sorgu: { type: "string" }, adet: { type: "number" } }, ["sorgu"]),
  },
  {
    name: "mail_gonder",
    description: "E-posta gönderir. Sadece kullanıcı alıcıyı, konuyu ve metni duyup açıkça onayladıktan sonra onaylandi=true ile çağır.",
    input_schema: obj(
      { alici: { type: "string" }, konu: { type: "string" }, metin: { type: "string" }, onaylandi: { type: "boolean" } },
      ["alici", "konu", "metin", "onaylandi"]
    ),
  },
  {
    name: "not_ekle",
    description: "Kullanıcının not defterine bir not ekler.",
    input_schema: obj({ metin: { type: "string" } }, ["metin"]),
  },
  {
    name: "notlari_oku",
    description: "Kullanıcının not defterindeki notları (en yeni en sonda) getirir.",
    input_schema: obj({}),
  },
  {
    name: "not_sil",
    description: "Not defterinden bir notu sırasına göre (1'den başlar) siler.",
    input_schema: obj({ sira: { type: "number" } }, ["sira"]),
  },
  {
    name: "muzik_cal",
    description: "Spotify'da şarkı, sanatçı, albüm veya çalma listesi arayıp çalar.",
    input_schema: obj(
      { sorgu: { type: "string" }, tur: { type: "string", enum: ["track", "artist", "album", "playlist"] } },
      ["sorgu", "tur"]
    ),
  },
  {
    name: "muzik_kontrol",
    description: "Spotify çalmayı kontrol eder: durdur, devam, sonraki, onceki, ses (0-100).",
    input_schema: obj(
      { eylem: { type: "string", enum: ["durdur", "devam", "sonraki", "onceki", "ses"] }, ses: { type: "number" } },
      ["eylem"]
    ),
  },
  {
    name: "simdi_calan",
    description: "Spotify'da şu an çalan şarkıyı söyler.",
    input_schema: obj({}),
  },
];

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Jarvis" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function weather({ enlem, boylam }) {
  const p = new URLSearchParams({
    latitude: enlem,
    longitude: boylam,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "Europe/Istanbul",
    forecast_days: "3",
  });
  const j = await getJson("https://api.open-meteo.com/v1/forecast?" + p);
  return {
    not: "weather_code (WMO): 0 açık, 1-3 parçalı bulutlu, 45-48 sis, 51-67 yağmur, 71-77 kar, 80-82 sağanak, 95-99 fırtına",
    simdi: j.current,
    gunluk: j.daily,
  };
}

async function news({ konu }) {
  const q = encodeURIComponent((konu || "gündem") + " when:1d");
  const r = await fetch(`https://news.google.com/rss/search?hl=tr&gl=TR&ceid=TR:tr&q=${q}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)]
    .slice(0, 10)
    .map((m) => ({ baslik: m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), tarih: m[2] }));
  return items.length ? items : { sonuc: "Haber bulunamadı" };
}

async function fx() {
  const j = await getJson("https://finans.truncgil.com/today.json");
  const keys = ["Update_Date", "USD", "EUR", "GBP", "gram-altin", "ceyrek-altin", "yarim-altin", "tam-altin", "cumhuriyet-altini", "ons", "gumus"];
  return Object.fromEntries(keys.filter((k) => k in j).map((k) => [k, j[k]]));
}

async function wiki({ konu }) {
  const s = await getJson(
    "https://tr.wikipedia.org/w/api.php?" +
      new URLSearchParams({ action: "query", list: "search", srsearch: konu, format: "json", srlimit: "1", origin: "*" })
  );
  const title = s.query?.search?.[0]?.title;
  if (!title) return { sonuc: "Bulunamadı" };
  const sum = await getJson("https://tr.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return { baslik: title, ozet: sum.extract };
}

async function notes(env) {
  return JSON.parse((await env.KV.get("notes")) || "[]");
}

export async function runTool(env, name, input) {
  switch (name) {
    case "hava_durumu":
      return weather(input);
    case "haberler":
      return news(input);
    case "doviz_altin":
      return fx();
    case "wikipedia":
      return wiki(input);
    case "takvim_oku":
      return calendarList(env, input.baslangic, input.bitis);
    case "takvim_ekle":
      return calendarCreate(env, input);
    case "mail_ara":
      return gmailSearch(env, input.sorgu, input.adet);
    case "mail_gonder":
      if (input.onaylandi !== true) return { gonderilmedi: true, sebep: "Önce kullanıcıdan açık onay al." };
      return gmailSend(env, input.alici, input.konu, input.metin);
    case "not_ekle": {
      const n = await notes(env);
      n.push({ metin: input.metin, tarih: new Date().toISOString() });
      await env.KV.put("notes", JSON.stringify(n.slice(-200)));
      return { tamam: true, toplam_not: n.length };
    }
    case "notlari_oku": {
      const n = await notes(env);
      return n.length ? n.map((x, i) => ({ sira: i + 1, ...x })) : { sonuc: "Not defteri boş" };
    }
    case "not_sil": {
      const n = await notes(env);
      const [silinen] = n.splice((input.sira || 0) - 1, 1);
      await env.KV.put("notes", JSON.stringify(n));
      return silinen ? { silindi: silinen.metin } : { hata: "Bu sırada not yok" };
    }
    case "muzik_cal":
      return spotifyPlay(env, input.sorgu, input.tur);
    case "muzik_kontrol":
      return spotifyControl(env, input.eylem, input.ses);
    case "simdi_calan":
      return spotifyNowPlaying(env);
    default:
      throw new Error("Bilinmeyen araç: " + name);
  }
}
