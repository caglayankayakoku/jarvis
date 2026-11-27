// Harita ve konum araçları: OpenStreetMap (Nominatim, Overpass) ve OSRM. Anahtar gerektirmez.
const UA = { "user-agent": "JarvisPersonalAssistant/1.0", "accept-language": "tr" };

async function j(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${new URL(url).host} -> ${r.status}`);
  return r.json();
}

function km(a, b) {
  const R = 6371, t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function placeSearch({ sorgu, enlem, boylam }) {
  const p = new URLSearchParams({ q: sorgu, format: "jsonv2", limit: "5", addressdetails: "0", countrycodes: "tr" });
  if (typeof enlem === "number" && typeof boylam === "number") {
    p.set("viewbox", `${boylam - 0.5},${enlem + 0.5},${boylam + 0.5},${enlem - 0.5}`);
  }
  let r = await j("https://nominatim.openstreetmap.org/search?" + p);
  if (!r.length) {
    p.delete("countrycodes");
    r = await j("https://nominatim.openstreetmap.org/search?" + p);
  }
  if (!r.length) return { sonuc: "Bulunamadı" };
  return r.map((x) => {
    const o = { ad: x.name || x.display_name.split(",")[0], adres: x.display_name, enlem: +x.lat, boylam: +x.lon };
    if (typeof enlem === "number") o.uzaklik_km = +km({ lat: enlem, lon: boylam }, { lat: o.enlem, lon: o.boylam }).toFixed(1);
    return o;
  });
}

export async function reverseGeocode({ enlem, boylam }) {
  const p = new URLSearchParams({ lat: enlem, lon: boylam, format: "jsonv2", zoom: "18" });
  const r = await j("https://nominatim.openstreetmap.org/reverse?" + p);
  const a = r.address || {};
  return {
    adres: r.display_name,
    mahalle: a.suburb || a.neighbourhood || a.quarter,
    ilce: a.town || a.city_district || a.district || a.county,
    il: a.province || a.city || a.state,
  };
}

const TYPES = {
  eczane: '["amenity"="pharmacy"]',
  hastane: '["amenity"="hospital"]',
  benzinlik: '["amenity"="fuel"]',
  kafe: '["amenity"="cafe"]',
  restoran: '["amenity"="restaurant"]',
  atm: '["amenity"="atm"]',
  banka: '["amenity"="bank"]',
  otopark: '["amenity"="parking"]',
  market: '["shop"~"supermarket|convenience"]',
  cami: '["amenity"="place_of_worship"]["religion"="muslim"]',
  firin: '["shop"="bakery"]',
  polis: '["amenity"="police"]',
  veteriner: '["amenity"="veterinary"]',
  sarj: '["amenity"="charging_station"]',
};

const OVERPASS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

export async function nearby({ tur, enlem, boylam, yaricap_m = 1500 }) {
  const f = TYPES[tur];
  if (!f) return { hata: "Desteklenen türler: " + Object.keys(TYPES).join(", ") };
  const rad = Math.min(Math.max(200, yaricap_m || 1500), 10000);
  const q = `[out:json][timeout:20];nwr${f}(around:${rad},${enlem},${boylam});out center 40;`;
  let r, lastErr;
  for (const host of OVERPASS) {
    try {
      r = await j(host + "?" + new URLSearchParams({ data: q }));
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!r) throw lastErr;
  const me = { lat: enlem, lon: boylam };
  const items = (r.elements || [])
    .map((e) => {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
      const t = e.tags || {};
      return {
        ad: t.name || "(isimsiz)",
        uzaklik_m: Math.round(km(me, { lat, lon }) * 1000),
        adres: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || undefined,
        saatler: t.opening_hours,
        telefon: t.phone || t["contact:phone"],
        enlem: lat,
        boylam: lon,
      };
    })
    .sort((a, b) => a.uzaklik_m - b.uzaklik_m)
    .slice(0, 8);
  return items.length ? items : { sonuc: `${rad} m içinde bulunamadı` };
}

export async function route({ bas_enlem, bas_boylam, hedef_enlem, hedef_boylam, mod = "arac" }) {
  const prof = { arac: "routed-car", yuruyus: "routed-foot", bisiklet: "routed-bike" }[mod] || "routed-car";
  const url = `https://routing.openstreetmap.de/${prof}/route/v1/driving/${bas_boylam},${bas_enlem};${hedef_boylam},${hedef_enlem}?overview=false`;
  const r = await j(url);
  const rt = r.routes?.[0];
  if (!rt) return { hata: "Rota bulunamadı" };
  return {
    mesafe_km: +(rt.distance / 1000).toFixed(1),
    sure_dk: Math.round(rt.duration / 60),
    not: mod === "arac" ? "Trafik dahil değil; yoğun saatte daha uzun sürebilir." : undefined,
  };
}

export function mapLink({ sorgu, enlem, boylam, hedef, mod }) {
  if (hedef) {
    const p = new URLSearchParams({ api: "1", destination: hedef, travelmode: { arac: "driving", yuruyus: "walking", bisiklet: "bicycling", toplu: "transit" }[mod] || "driving" });
    return "https://www.google.com/maps/dir/?" + p;
  }
  const q = sorgu || `${enlem},${boylam}`;
  return "https://www.google.com/maps/search/?" + new URLSearchParams({ api: "1", query: q });
}
