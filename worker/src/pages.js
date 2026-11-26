// Kurulum sayfası: Google ve Spotify hesaplarını Jarvis'e bağlamak için.

const STYLE = `
:root{--bg:#020a14;--fg:#cfefff;--accent:#38c8ff;--muted:#6f93ab;--ok:#4ee0a0;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 20%,#06223a,var(--bg) 70%);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;justify-content:center;padding:24px 16px}
main{width:100%;max-width:460px}h1{font-weight:300;letter-spacing:.3em;color:var(--accent);text-align:center;margin:8px 0 24px}
.card{border:1px solid #13405e;border-radius:14px;padding:16px;margin-bottom:14px;background:#04182980}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.st{font-size:14px;color:var(--muted)}.st.ok{color:var(--ok)}.st.bad{color:var(--bad)}
button,input{font:inherit;border-radius:10px;border:1px solid #1c5a82;background:#06223a;color:var(--fg);padding:10px 14px}
button{cursor:pointer;color:var(--accent)}button:disabled{opacity:.4;cursor:default}
input{width:100%}p{color:var(--muted);font-size:14px;line-height:1.5}`;

export function setupPage() {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Kurulum</title><style>${STYLE}</style></head><body><main>
<h1>JARVIS</h1>
<div class="card" id="login"><p>Jarvis şifreni gir.</p><input id="key" type="password" autocomplete="current-password"><p></p><button id="go">Devam</button></div>
<div id="panel" hidden>
  <div class="card"><div class="row"><div><b>Google</b><div class="st" id="gs">…</div></div><button id="gb">Bağla</button></div><p>Gmail ve Takvim için.</p></div>
  <div class="card"><div class="row"><div><b>Spotify</b><div class="st" id="ss">…</div></div><button id="sb">Bağla</button></div><p>Müzik kontrolü için (Premium gerekir).</p></div>
  <div class="card"><div class="row"><div><b>Sabah brifingi</b><div class="st" id="bs">Her gün 08:00</div></div><button id="bb">Şimdi gönder</button></div></div>
</div>
<script>
let KEY='';try{KEY=sessionStorage.getItem('jk')||''}catch(e){}
const $=id=>document.getElementById(id);
async function api(p,m='GET'){const r=await fetch(p,{method:m,headers:{'x-jarvis-key':KEY}});if(r.status===403)throw new Error('Şifre yanlış');return r.json()}
function st(el,ok,ready,label){el.textContent=ok?'Bağlı':(ready?'Bağlı değil':'Anahtarlar eksik ('+label+')');el.className='st '+(ok?'ok':'bad')}
async function load(){try{const d=await api('/durum');$('login').hidden=true;$('panel').hidden=false;
st($('gs'),d.google,d.googleAyarli,'Google');st($('ss'),d.spotify,d.spotifyAyarli,'Spotify');
$('gb').disabled=!d.googleAyarli;$('sb').disabled=!d.spotifyAyarli;
$('gb').textContent=d.google?'Yeniden bağla':'Bağla';$('sb').textContent=d.spotify?'Yeniden bağla':'Bağla';
try{sessionStorage.setItem('jk',KEY)}catch(e){}}catch(e){$('login').hidden=false;$('panel').hidden=true;$('login').querySelector('p:nth-of-type(2)').textContent=KEY?e.message:''}}
async function connect(p){const d=await api('/baglan/'+p,'POST');if(d.url)location.href=d.url;else alert(d.error||'Hata')}
$('go').onclick=()=>{KEY=$('key').value;load()};$('key').onkeydown=e=>{if(e.key==='Enter')$('go').click()};
$('gb').onclick=()=>connect('google');$('sb').onclick=()=>connect('spotify');
$('bb').onclick=async()=>{$('bb').disabled=true;$('bs').textContent='Hazırlanıyor…';try{const d=await api('/brifing','POST');$('bs').textContent=d.gonderildi?'Mailine gönderildi':(d.output||'Hata')}catch(e){$('bs').textContent=e.message}$('bb').disabled=false};
if(KEY)load();
</script></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export function resultPage(ok, message) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Kurulum</title><style>${STYLE}</style></head><body><main><h1>JARVIS</h1>
<div class="card"><div class="st ${ok ? "ok" : "bad"}">${ok ? "Tamamlandı" : "Olmadı"}</div><p>${esc(message)}</p><button onclick="location.href='/kurulum'">Kurulum sayfasına dön</button></div>
</main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
