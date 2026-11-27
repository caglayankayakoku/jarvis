// Jarvis sunucusu (Cloudflare Worker)
//   POST /chat          {chatInput, sessionId} -> {output}     (X-Jarvis-Key gerekir)
//   GET  /kurulum       Google ve Spotify bağlantı sayfası
//   POST /brifing       Sabah brifingini hemen gönderir (test için)
//   cron 05:00 UTC      Sabah brifingi (08:00 İstanbul)
import { runAgent } from "./agent.js";
import { googleAuthUrl, googleExchangeCode, gmailMyAddress, gmailSend } from "./google.js";
import { spotifyAuthUrl, spotifyExchangeCode } from "./spotify.js";
import { setupPage, resultPage, privacyPage } from "./pages.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-jarvis-key",
  "access-control-max-age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

function authorized(req, env) {
  const k = req.headers.get("x-jarvis-key") || "";
  if (!env.JARVIS_KEY || k.length !== env.JARVIS_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ env.JARVIS_KEY.charCodeAt(i);
  return diff === 0;
}

const HISTORY_LIMIT = 20;

async function handleChat(req, env) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.chatInput || "").trim();
  const sid = String(body.sessionId || "varsayilan").slice(0, 80);
  if (!text) return json({ output: "Seni duyamadım, tekrar söyler misin?" });

  const key = "hist:" + sid;
  const history = JSON.parse((await env.KV.get(key)) || "[]");
  const k = body.konum;
  const konum = k && Number.isFinite(+k.lat) && Number.isFinite(+k.lon) ? { lat: (+k.lat).toFixed(5), lon: (+k.lon).toFixed(5) } : null;
  const { text: answer, actions } = await runAgent(env, history, text, { konum });
  const next = [...history, { role: "user", content: text }, { role: "assistant", content: answer }].slice(-HISTORY_LIMIT);
  await env.KV.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 7 });
  return json({ output: answer, actions: actions || [] });
}

const BRIEF_PROMPT = `Sabah brifingi hazırla. Araçlarla şunları topla: İstanbul hava durumu, bugünün takvim etkinlikleri, son 24 saatteki okunmamış önemli mailler (mail_ara: is:unread newer_than:1d, adet 10), Türkiye gündeminden 4-5 önemli başlık, dolar, euro ve gram altın.
Bu metin e-postayla gidecek: 'Günaydın Çağlayan' ile başla, Hava, Takvim, Mailler, Gündem, Piyasalar başlıklarıyla kısa ve düzenli yaz, düz metin kullan (markdown sembolü yok), kısa motive edici bir cümleyle bitir.`;

async function sendBriefing(env) {
  const { text } = await runAgent(env, [], BRIEF_PROMPT, { maxTurns: 10 });
  const to = await gmailMyAddress(env);
  const date = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short" }).format(new Date());
  await gmailSend(env, to, "☀️ Jarvis Sabah Brifingi - " + date, text);
  return text;
}

async function startOAuth(req, env, provider) {
  const origin = new URL(req.url).origin;
  const state = crypto.randomUUID();
  await env.KV.put("oauth:" + state, provider, { expirationTtl: 600 });
  const redirect = `${origin}/oauth/${provider}`;
  if (provider === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET eksik" }, 400);
    return json({ url: googleAuthUrl(env, redirect, state) });
  }
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return json({ error: "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET eksik" }, 400);
  return json({ url: spotifyAuthUrl(env, redirect, state) });
}

async function finishOAuth(req, env, provider) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || (await env.KV.get("oauth:" + state)) !== provider) return resultPage(false, "Bağlantı isteği geçersiz veya süresi dolmuş. Kurulum sayfasından tekrar dene.");
  await env.KV.delete("oauth:" + state);
  if (!code) return resultPage(false, "İzin verilmedi: " + (url.searchParams.get("error") || "bilinmiyor"));
  const redirect = `${url.origin}/oauth/${provider}`;
  try {
    if (provider === "google") await googleExchangeCode(env, code, redirect);
    else await spotifyExchangeCode(env, code, redirect);
    return resultPage(true, provider === "google" ? "Google (Gmail ve Takvim) bağlandı." : "Spotify bağlandı.");
  } catch (e) {
    return resultPage(false, String(e.message || e));
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (path === "/" && req.method === "GET") return json({ jarvis: "çalışıyor" });
      if (path === "/kurulum" && req.method === "GET") return setupPage(url.origin);
      if (path === "/gizlilik" && req.method === "GET") return privacyPage();
      if (path === "/oauth/google" && req.method === "GET") return finishOAuth(req, env, "google");
      if (path === "/oauth/spotify" && req.method === "GET") return finishOAuth(req, env, "spotify");

      if (!authorized(req, env)) return json({ error: "Yetkisiz" }, 403);

      if (path === "/chat" && req.method === "POST") return await handleChat(req, env);
      if (path === "/durum" && req.method === "GET")
        return json({
          google: !!(await env.KV.get("google:refresh")),
          spotify: !!(await env.KV.get("spotify:refresh")),
          googleAyarli: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
          spotifyAyarli: !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
          spotifySecretBicim: /^[0-9a-f]{32}$/i.test(String(env.SPOTIFY_CLIENT_SECRET || "").trim()),
        });
      if (path === "/gecmis" && req.method === "GET") {
        const list = await env.KV.list({ prefix: "hist:" });
        const out = {};
        for (const k of list.keys) out[k.name] = JSON.parse((await env.KV.get(k.name)) || "[]");
        return json(out);
      }
      if (path === "/baglan/google" && req.method === "POST") return startOAuth(req, env, "google");
      if (path === "/baglan/spotify" && req.method === "POST") return startOAuth(req, env, "spotify");
      if (path === "/brifing" && req.method === "POST") return json({ gonderildi: true, metin: await sendBriefing(env) });
      return json({ error: "Bulunamadı" }, 404);
    } catch (e) {
      console.error(e);
      return json({ output: "Bir sorun çıktı: " + String(e.message || e).slice(0, 200) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendBriefing(env).catch((e) => console.error("Brifing hatası", e)));
  },
};
