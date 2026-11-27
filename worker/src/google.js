// Google (Gmail + Takvim) bağlantısı: OAuth akışı ve erişim jetonu yenileme.

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function googleAuthUrl(env, redirectUri, state) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p;
}

export async function googleExchangeCode(env, code, redirectUri) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (!j.refresh_token) throw new Error("Google yenileme jetonu vermedi: " + JSON.stringify(j));
  await env.KV.put("google:refresh", j.refresh_token);
  await env.KV.put("google:access", j.access_token, { expirationTtl: Math.max(60, (j.expires_in || 3600) - 120) });
}

async function googleToken(env) {
  const cached = await env.KV.get("google:access");
  if (cached) return cached;
  const refresh = await env.KV.get("google:refresh");
  if (!refresh) throw new Error("Google hesabı henüz bağlanmadı. Kurulum sayfasından bağlanmalı.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google jetonu yenilenemedi: " + (j.error_description || j.error));
  await env.KV.put("google:access", j.access_token, { expirationTtl: Math.max(60, (j.expires_in || 3600) - 120) });
  return j.access_token;
}

async function gapi(env, url, init = {}) {
  const token = await googleToken(env);
  const r = await fetch(url, {
    ...init,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Google API ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// ---- Takvim ----
export async function calendarList(env, timeMin, timeMax) {
  const p = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "25" });
  const j = await gapi(env, "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + p);
  return (j.items || []).map((e) => ({
    id: e.id,
    baslik: e.summary || "(başlıksız)",
    baslangic: e.start?.dateTime || e.start?.date,
    bitis: e.end?.dateTime || e.end?.date,
    yer: e.location,
  }));
}

export async function calendarCreate(env, { baslik, baslangic, bitis, aciklama, hatirlatma_dakika }) {
  const body = {
    summary: baslik,
    description: aciklama,
    start: { dateTime: baslangic, timeZone: "Europe/Istanbul" },
    end: { dateTime: bitis, timeZone: "Europe/Istanbul" },
  };
  if (typeof hatirlatma_dakika === "number") {
    body.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: hatirlatma_dakika }] };
  }
  const e = await gapi(env, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { tamam: true, baslik: e.summary, baslangic: e.start?.dateTime };
}

export async function calendarDelete(env, id) {
  await gapi(env, "https://www.googleapis.com/calendar/v3/calendars/primary/events/" + encodeURIComponent(id), { method: "DELETE" });
  return { silindi: true };
}

export async function calendarUpdate(env, { id, baslik, baslangic, bitis, aciklama }) {
  const body = {};
  if (baslik) body.summary = baslik;
  if (aciklama) body.description = aciklama;
  if (baslangic) body.start = { dateTime: baslangic, timeZone: "Europe/Istanbul" };
  if (bitis) body.end = { dateTime: bitis, timeZone: "Europe/Istanbul" };
  const e = await gapi(env, "https://www.googleapis.com/calendar/v3/calendars/primary/events/" + encodeURIComponent(id), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return { guncellendi: true, baslik: e.summary, baslangic: e.start?.dateTime || e.start?.date };
}

// ---- Gmail ----
export async function gmailSearch(env, q, max = 5) {
  const p = new URLSearchParams({ q: q || "is:unread", maxResults: String(Math.min(max || 5, 10)) });
  const list = await gapi(env, "https://gmail.googleapis.com/gmail/v1/users/me/messages?" + p);
  const ids = (list.messages || []).map((m) => m.id);
  const out = await Promise.all(
    ids.map(async (id) => {
      const m = await gapi(
        env,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
      );
      const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name, x.value]));
      return { id, kimden: h.From, konu: h.Subject, tarih: h.Date, ozet: m.snippet };
    })
  );
  return out;
}

function decodeB64url(data) {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function findBody(part) {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) return { text: decodeB64url(part.body.data) };
  for (const p of part.parts || []) {
    const r = findBody(p);
    if (r?.text) return r;
  }
  if (part.mimeType === "text/html" && part.body?.data) return { html: decodeB64url(part.body.data) };
  for (const p of part.parts || []) {
    const r = findBody(p);
    if (r) return r;
  }
  return null;
}

export async function gmailRead(env, id) {
  const m = await gapi(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name, x.value]));
  const b = findBody(m.payload) || {};
  let text = b.text || (b.html || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim().slice(0, 6000);
  return { kimden: h.From, konu: h.Subject, tarih: h.Date, metin: text || m.snippet };
}

export async function gmailMyAddress(env) {
  const j = await gapi(env, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  return j.emailAddress;
}

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeHeader(s) {
  return /^[\x00-\x7F]*$/.test(s) ? s : "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + "?=";
}

export async function gmailSend(env, to, subject, text) {
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
  await gapi(env, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  return { gonderildi: true, alici: to };
}
