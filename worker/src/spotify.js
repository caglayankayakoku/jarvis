// Spotify bağlantısı: OAuth akışı ve çalma kontrolü (Premium gerekir).

export const SPOTIFY_SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";

export function spotifyAuthUrl(env, redirectUri, state) {
  const p = new URLSearchParams({
    client_id: String(env.SPOTIFY_CLIENT_ID).trim(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    state,
  });
  return "https://accounts.spotify.com/authorize?" + p;
}

function basicAuth(env) {
  return "Basic " + btoa(`${String(env.SPOTIFY_CLIENT_ID).trim()}:${String(env.SPOTIFY_CLIENT_SECRET).trim()}`);
}

export async function spotifyExchangeCode(env, code, redirectUri) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth(env) },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const j = await r.json();
  if (!j.refresh_token) throw new Error("Spotify yenileme jetonu vermedi: " + JSON.stringify(j));
  await env.KV.put("spotify:refresh", j.refresh_token);
  await env.KV.put("spotify:access", j.access_token, { expirationTtl: Math.max(60, (j.expires_in || 3600) - 120) });
}

async function spotifyToken(env) {
  const cached = await env.KV.get("spotify:access");
  if (cached) return cached;
  const refresh = await env.KV.get("spotify:refresh");
  if (!refresh) throw new Error("Spotify hesabı henüz bağlanmadı. Kurulum sayfasından bağlanmalı.");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth(env) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Spotify jetonu yenilenemedi: " + (j.error_description || j.error));
  if (j.refresh_token) await env.KV.put("spotify:refresh", j.refresh_token);
  await env.KV.put("spotify:access", j.access_token, { expirationTtl: Math.max(60, (j.expires_in || 3600) - 120) });
  return j.access_token;
}

async function sapi(env, path, init = {}) {
  const token = await spotifyToken(env);
  const r = await fetch("https://api.spotify.com/v1" + path, {
    ...init,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  if (r.status === 404 && text.includes("NO_ACTIVE_DEVICE")) {
    const err = new Error("NO_ACTIVE_DEVICE");
    err.noDevice = true;
    throw err;
  }
  if (!r.ok) throw new Error(`Spotify ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Aktif cihaz yoksa son kullanılan cihaza aktarmayı dener.
async function withDevice(env, fn) {
  try {
    return await fn();
  } catch (e) {
    if (!e.noDevice) throw e;
    const d = await sapi(env, "/me/player/devices");
    const dev = (d.devices || [])[0];
    if (!dev) {
      const err = new Error("Açık bir Spotify cihazı yok.");
      err.noDevice = true;
      err.none = true;
      throw err;
    }
    await sapi(env, "/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [dev.id], play: false }) });
    return await fn();
  }
}

// Uygulama Spotify'ı açtıktan sonra çağırır: aktif cihaza aktarıp çalar.
export async function spotifyPlayUri(env, uri) {
  const body = uri && uri.startsWith("spotify:track:") ? { uris: [uri] } : uri ? { context_uri: uri } : undefined;
  await withDevice(env, () => sapi(env, "/me/player/play", { method: "PUT", body: body ? JSON.stringify(body) : undefined }));
  return { caliyor: true };
}

export async function spotifyPlay(env, sorgu, tur = "track", ctx = { actions: [] }) {
  const type = ["track", "playlist", "artist", "album"].includes(tur) ? tur : "track";
  const s = await sapi(env, `/search?${new URLSearchParams({ q: sorgu, type, limit: "1", market: "TR" })}`);
  const item = s[type + "s"]?.items?.find(Boolean);
  if (!item) return { bulunamadi: true, sorgu };
  const body = type === "track" ? { uris: [item.uri] } : { context_uri: item.uri };
  const kim0 = item.artists?.map((a) => a.name).join(", ") || item.owner?.display_name || "";
  try {
    await withDevice(env, () => sapi(env, "/me/player/play", { method: "PUT", body: JSON.stringify(body) }));
  } catch (e) {
    if (!e.none) throw e;
    // Açık cihaz yok: telefondaki uygulama Spotify'ı açacak, sonra çalmayı başlatacak.
    ctx.actions.push({ tur: "spotify", uri: item.uri, link: item.external_urls?.spotify });
    return { caliyor: item.name, sanatci: kim0, not: "Spotify telefonda açılıyor, şarkı birkaç saniye içinde başlayacak." };
  }
  const kim = item.artists?.map((a) => a.name).join(", ") || item.owner?.display_name || "";
  return { caliyor: item.name, sanatci: kim, tur: type };
}

export async function spotifyControl(env, eylem, ses, ctx = { actions: [] }) {
  const map = {
    durdur: ["PUT", "/me/player/pause"],
    devam: ["PUT", "/me/player/play"],
    sonraki: ["POST", "/me/player/next"],
    onceki: ["POST", "/me/player/previous"],
  };
  if (eylem === "ses") {
    const v = Math.max(0, Math.min(100, Math.round(ses ?? 50)));
    await withDevice(env, () => sapi(env, `/me/player/volume?volume_percent=${v}`, { method: "PUT" }));
    return { tamam: true, ses: v };
  }
  const m = map[eylem];
  if (!m) return { hata: "Bilinmeyen eylem" };
  try {
    await withDevice(env, () => sapi(env, m[1], { method: m[0] }));
  } catch (e) {
    if (!e.none) throw e;
    if (eylem === "durdur") return { tamam: true, not: "Zaten çalan bir şey yok." };
    ctx.actions.push({ tur: "spotify", uri: "", link: "https://open.spotify.com" });
    return { not: "Spotify telefonda açılıyor, birkaç saniye içinde devam edecek." };
  }
  return { tamam: true, eylem };
}

export async function spotifyNowPlaying(env) {
  const j = await sapi(env, "/me/player/currently-playing");
  if (!j.item) return { caliyor: null };
  return { caliyor: j.item.name, sanatci: j.item.artists?.map((a) => a.name).join(", "), aktif: j.is_playing };
}
