// Jarvis'in araçları: Claude'a tanıtılan tanımlar ve onları çalıştıran kod.
import { calendarList, calendarCreate, calendarDelete, calendarUpdate, gmailSearch, gmailRead, gmailSend } from "./google.js";
import { placeSearch, reverseGeocode, nearby, route, mapLink } from "./maps.js";
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
    name: "kripto",
    description: "Kripto paraların (bitcoin, ethereum, solana, usdt vb.) güncel TL ve dolar fiyatını getirir.",
    input_schema: obj({ coinler: { type: "array", items: { type: "string" }, description: "Coin adları veya sembolleri" } }, ["coinler"]),
  },
  {
    name: "hisse",
    description: "Hisse senedi veya endeks fiyatını getirir. Borsa İstanbul için sembolün sonuna .IS ekle (THYAO.IS, ASELS.IS, XU100.IS). Yabancı hisseler için düz sembol (AAPL, TSLA).",
    input_schema: obj({ semboller: { type: "array", items: { type: "string" } } }, ["semboller"]),
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
    name: "takvim_sil",
    description: "Takvimden bir etkinliği siler. id'yi önce takvim_oku ile bul. Silmeden önce hangi etkinlik olduğunu kullanıcıya söyleyip onay al.",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "takvim_guncelle",
    description: "Takvimdeki bir etkinliğin başlığını, saatini veya açıklamasını değiştirir. id'yi önce takvim_oku ile bul. Sadece değişen alanları ver.",
    input_schema: obj(
      { id: { type: "string" }, baslik: { type: "string" }, baslangic: { type: "string" }, bitis: { type: "string" }, aciklama: { type: "string" } },
      ["id"]
    ),
  },
  {
    name: "mail_ara",
    description: "Gmail'de mail arar ve kimden/konu/özet döndürür. Gmail arama sözdizimi kullan (örn. 'is:unread newer_than:1d', 'from:ali').",
    input_schema: obj({ sorgu: { type: "string" }, adet: { type: "number" } }, ["sorgu"]),
  },
  {
    name: "mail_oku",
    description: "Bir mailin tam metnini getirir. id'yi önce mail_ara ile bul. Kullanıcı 'şu maili oku/özetle' derse kullan.",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
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
    name: "hafiza_kaydet",
    description: "Kullanıcı hakkında kalıcı bir bilgiyi hatırlamak için kaydeder (ör. doğum günü, sevdiği takım, eşinin adı, tercihleri). Kullanıcı 'bunu unutma/hatırla' derse veya önemli kişisel bir bilgi paylaşırsa kullan. Kısa ve tek cümle yaz.",
    input_schema: obj({ bilgi: { type: "string" } }, ["bilgi"]),
  },
  {
    name: "hafiza_sil",
    description: "Kalıcı hafızadan bir bilgiyi sırasına göre (1'den başlar) siler. Hafıza sistem mesajında numaralı listelenir.",
    input_schema: obj({ sira: { type: "number" } }, ["sira"]),
  },
  {
    name: "namaz_vakitleri",
    description: "Bir şehrin bugünkü (veya verilen tarihteki) namaz/ezan vakitlerini Diyanet hesabıyla getirir. İftar = akşam, sahur/imsak = imsak.",
    input_schema: obj({ sehir: { type: "string" }, tarih: { type: "string", description: "GG-AA-YYYY, boşsa bugün" } }, ["sehir"]),
  },
  {
    name: "depremler",
    description: "Türkiye ve çevresindeki son depremleri (büyüklük, yer, saat, derinlik) getirir.",
    input_schema: obj({ min_buyukluk: { type: "number", description: "Varsayılan 3" }, saat: { type: "number", description: "Son kaç saat, varsayılan 24" } }),
  },
  {
    name: "zamanlayici",
    description: "Uygulamada geri sayım/alarm kurar; süre dolunca telefon sesli uyarır. 'Beş dakika sonra haber ver', 'yumurta için 7 dakika' gibi kısa süreler için kullan. Uygulama açık kalmalı; saatler sonrası için takvim_ekle hatırlatıcısını tercih et.",
    input_schema: obj({ saniye: { type: "number" }, etiket: { type: "string" } }, ["saniye"]),
  },
  {
    name: "yer_ara",
    description: "Bir yeri, adresi veya işletmeyi haritada arar; adres ve koordinat döndürür. Kullanıcının konumu biliniyorsa enlem/boylam ver, yakındakiler öne çıkar.",
    input_schema: obj({ sorgu: { type: "string" }, enlem: { type: "number" }, boylam: { type: "number" } }, ["sorgu"]),
  },
  {
    name: "neredeyim",
    description: "Koordinatı adrese çevirir (mahalle, ilçe, il). 'Neredeyim?' sorusunda kullanıcının konumuyla çağır.",
    input_schema: obj({ enlem: { type: "number" }, boylam: { type: "number" } }, ["enlem", "boylam"]),
  },
  {
    name: "yakindakiler",
    description: "Bir konumun yakınındaki yerleri en yakından uzağa listeler. Türler: eczane, hastane, benzinlik, kafe, restoran, atm, banka, otopark, market, cami, firin, polis, veteriner, sarj. Nöbetçi eczane bilgisi içermez; onun için web_search kullan.",
    input_schema: obj(
      { tur: { type: "string" }, enlem: { type: "number" }, boylam: { type: "number" }, yaricap_m: { type: "number" } },
      ["tur", "enlem", "boylam"]
    ),
  },
  {
    name: "yol_suresi",
    description: "İki nokta arası mesafe ve tahmini süre (trafiksiz). mod: arac, yuruyus, bisiklet. Adres verilirse önce yer_ara ile koordinat bul.",
    input_schema: obj(
      {
        bas_enlem: { type: "number" }, bas_boylam: { type: "number" }, hedef_enlem: { type: "number" }, hedef_boylam: { type: "number" },
        mod: { type: "string", enum: ["arac", "yuruyus", "bisiklet"] },
      },
      ["bas_enlem", "bas_boylam", "hedef_enlem", "hedef_boylam"]
    ),
  },
  {
    name: "harita_ac",
    description: "Kullanıcının telefonunda Google Haritalar'ı açar. Bir yeri göstermek için sorgu (veya enlem/boylam), yol tarifi başlatmak için hedef (adres ya da 'enlem,boylam') ve mod (arac, yuruyus, bisiklet, toplu) ver.",
    input_schema: obj({
      sorgu: { type: "string" }, enlem: { type: "number" }, boylam: { type: "number" }, hedef: { type: "string" },
      mod: { type: "string", enum: ["arac", "yuruyus", "bisiklet", "toplu"] },
    }),
  },
  {
    name: "muzik_cal",
    description: "Spotify'da şarkı, sanatçı, albüm veya çalma listesi arayıp çalar. Spotify kapalıysa telefonda otomatik açılır; 'Spotify'ı aç' isteğinde de bunu kullan.",
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

const COIN = { bitcoin: "BTC", btc: "BTC", ethereum: "ETH", eth: "ETH", ether: "ETH", solana: "SOL", sol: "SOL", tether: "USDT", usdt: "USDT",
  ripple: "XRP", xrp: "XRP", avalanche: "AVAX", avax: "AVAX", dogecoin: "DOGE", doge: "DOGE", bnb: "BNB", binance: "BNB", cardano: "ADA", ada: "ADA",
  tron: "TRX", trx: "TRX", polkadot: "DOT", dot: "DOT", chainlink: "LINK", link: "LINK", litecoin: "LTC", ltc: "LTC", shiba: "SHIB", shib: "SHIB",
  pepe: "PEPE", toncoin: "TON", ton: "TON", sui: "SUI", polygon: "POL", matic: "POL", usdc: "USDC" };

async function crypto({ coinler = [] }) {
  // Coinbase herkese açık spot fiyatı (Cloudflare'den erişilebiliyor).
  const spot = async (sym, cur) => {
    try {
      const j = await getJson(`https://api.coinbase.com/v2/prices/${sym}-${cur}/spot`);
      return +(+j.data.amount).toFixed(sym === "SHIB" || sym === "PEPE" ? 8 : 2);
    } catch (e) {
      return undefined;
    }
  };
  const out = await Promise.all(
    coinler.slice(0, 6).map(async (c) => {
      const sym = COIN[String(c).toLowerCase().trim()] || String(c).toUpperCase().trim();
      const [tl, dolar] = await Promise.all([spot(sym, "TRY"), spot(sym, "USD")]);
      return tl || dolar ? { coin: sym, tl, dolar } : { coin: c, hata: "Fiyat bulunamadı, web_search ile dene" };
    })
  );
  return out.length ? out : { sonuc: "Coin belirtilmedi" };
}

async function stocks({ semboller = [] }) {
  return Promise.all(
    semboller.slice(0, 6).map(async (sym) => {
      try {
        const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
        const m = j.chart?.result?.[0]?.meta;
        if (!m) return { sembol: sym, hata: "Bulunamadı" };
        const prev = m.chartPreviousClose ?? m.previousClose;
        return {
          sembol: sym,
          ad: m.longName || m.shortName,
          fiyat: m.regularMarketPrice,
          para_birimi: m.currency,
          onceki_kapanis: prev,
          degisim_yuzde: prev ? +(((m.regularMarketPrice - prev) / prev) * 100).toFixed(2) : undefined,
          zaman: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : undefined,
        };
      } catch (e) {
        return { sembol: sym, hata: "Fiyat alınamadı, web_search ile dene" };
      }
    })
  );
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

async function prayerTimes({ sehir, tarih }) {
  const d = tarih || new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul" }).format(new Date()).replace(/\//g, "-");
  const p = new URLSearchParams({ city: sehir || "Istanbul", country: "Turkey", method: "13" });
  const j = await getJson(`https://api.aladhan.com/v1/timingsByCity/${d}?` + p);
  const t = j.data?.timings || {};
  return { sehir, tarih: d, imsak: t.Imsak, gunes: t.Sunrise, ogle: t.Dhuhr, ikindi: t.Asr, aksam: t.Maghrib, yatsi: t.Isha, hicri: j.data?.date?.hijri?.date };
}

async function earthquakes({ min_buyukluk = 3, saat = 24 }) {
  const mag = Math.max(0, min_buyukluk ?? 3);
  const hours = Math.min(Math.max(1, saat ?? 24), 24 * 30);
  const fmt = (d) => d.toISOString().slice(0, 19);
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600e3);
  try {
    const p = new URLSearchParams({ start: fmt(start), end: fmt(end), minmag: String(mag), orderby: "timedesc", limit: "15" });
    const j = await getJson("https://deprem.afad.gov.tr/apiv2/event/filter?" + p);
    if (Array.isArray(j))
      return {
        kaynak: "AFAD",
        depremler: j.slice(0, 15).map((e) => ({ buyukluk: e.magnitude, yer: e.location, saat_utc: e.date, derinlik_km: e.depth })),
      };
  } catch (e) {}
  const p = new URLSearchParams({
    format: "geojson", starttime: fmt(start), minmagnitude: String(mag), orderby: "time", limit: "15",
    minlatitude: "34", maxlatitude: "43", minlongitude: "24", maxlongitude: "46",
  });
  const j = await getJson("https://earthquake.usgs.gov/fdsnws/event/1/query?" + p);
  return {
    kaynak: "USGS",
    depremler: (j.features || []).map((f) => ({
      buyukluk: f.properties.mag, yer: f.properties.place, saat_utc: new Date(f.properties.time).toISOString(), derinlik_km: f.geometry?.coordinates?.[2],
    })),
  };
}

export async function getMemory(env) {
  return JSON.parse((await env.KV.get("memory")) || "[]");
}

async function notes(env) {
  return JSON.parse((await env.KV.get("notes")) || "[]");
}

export async function runTool(env, name, input, ctx = { actions: [] }) {
  switch (name) {
    case "hava_durumu":
      return weather(input);
    case "haberler":
      return news(input);
    case "doviz_altin":
      return fx();
    case "wikipedia":
      return wiki(input);
    case "kripto":
      return crypto(input);
    case "hisse":
      return stocks(input);
    case "takvim_oku":
      return calendarList(env, input.baslangic, input.bitis);
    case "takvim_ekle":
      return calendarCreate(env, input);
    case "takvim_sil":
      return calendarDelete(env, input.id);
    case "takvim_guncelle":
      return calendarUpdate(env, input);
    case "mail_oku":
      return gmailRead(env, input.id);
    case "hafiza_kaydet": {
      const m = await getMemory(env);
      m.push(String(input.bilgi).slice(0, 300));
      await env.KV.put("memory", JSON.stringify(m.slice(-100)));
      return { kaydedildi: true };
    }
    case "hafiza_sil": {
      const m = await getMemory(env);
      const [silinen] = m.splice((input.sira || 0) - 1, 1);
      await env.KV.put("memory", JSON.stringify(m));
      return silinen ? { silindi: silinen } : { hata: "Bu sırada bilgi yok" };
    }
    case "namaz_vakitleri":
      return prayerTimes(input);
    case "depremler":
      return earthquakes(input);
    case "zamanlayici": {
      const sn = Math.round(Number(input.saniye) || 0);
      if (sn < 1 || sn > 24 * 3600) return { hata: "Süre 1 saniye ile 24 saat arasında olmalı" };
      ctx.actions.push({ tur: "zamanlayici", saniye: sn, etiket: input.etiket || "Süre doldu" });
      return { kuruldu: true, saniye: sn, not: "Uygulama açık kalmalı" };
    }
    case "yer_ara":
      return placeSearch(input);
    case "neredeyim":
      return reverseGeocode(input);
    case "yakindakiler":
      return nearby(input);
    case "yol_suresi":
      return route(input);
    case "harita_ac": {
      const url = mapLink(input);
      ctx.actions.push({ tur: "harita", url });
      return { acildi: true };
    }
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
      return spotifyPlay(env, input.sorgu, input.tur, ctx);
    case "muzik_kontrol":
      return spotifyControl(env, input.eylem, input.ses, ctx);
    case "simdi_calan":
      return spotifyNowPlaying(env);
    default:
      throw new Error("Bilinmeyen araç: " + name);
  }
}
