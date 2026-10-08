/**
 * Watch Key — all-in-one setup helper (Cloudflare Worker)
 *
 * One file. No Android Studio, no curl, no PowerShell needed by the end user.
 * Deploy: Cloudflare dashboard -> Workers -> "Create" -> "Start with Hello World!"
 * (a script-based Worker, NOT "Upload static files") -> paste this whole file in
 * the editor -> Deploy. Then:
 *   1. Settings -> Bindings -> Add binding -> KV namespace -> create one called
 *      "STORE" (any name is fine, but the binding name in your Worker must be STORE).
 *   2. Settings -> Variables -> add SETUP_PIN (any password you choose) as a
 *      normal (or "Encrypt") variable. This protects the /setup page.
 *   3. Open https://<your-worker>.workers.dev/setup and enter that PIN.
 *
 * Routes:
 *   GET  /                                  - simple info page
 *   GET  /callback                          - Tesla OAuth callback page
 *   PUT  /api/code/:sid     GET /api/code/:sid       - OAuth code relay (watch <-> phone)
 *   PUT  /api/pubkey/:sid   GET /api/pubkey/:sid     - Public key relay (watch -> phone)
 *   PUT  /api/clientid/:sid GET /api/clientid/:sid   - Client ID relay (phone -> watch)
 *   GET  /.well-known/appspecific/com.tesla.3p.public-key.pem  - hosted public key
 *   GET  /setup                             - admin page (enter PIN to use)
 *   POST /setup/save-key                    - store the currently-hosted public key
 *   POST /setup/register                    - do the Tesla partner_accounts registration
 *   GET  /privacy                           - privacy policy (for Google Play / Tesla review)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function text(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extra } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

const PAGE_STYLE = `
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0f14;color:#e7f3ee;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}
  .card{max-width:520px;width:100%;background:#131a21;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
  h1{font-size:20px;margin:0 0 12px;color:#87e8ce}
  p{line-height:1.6;font-size:15px;color:#cdd9d4}
  label{display:block;font-size:13px;color:#9caeba;margin:14px 0 4px}
  input,textarea{width:100%;box-sizing:border-box;background:#0e141a;border:1px solid #223029;border-radius:8px;
    color:#e7f3ee;padding:10px;font-size:14px;font-family:monospace}
  button{margin-top:16px;width:100%;padding:12px;border:none;border-radius:10px;background:#87e8ce;color:#0b0f14;
    font-weight:600;font-size:15px;cursor:pointer}
  button:active{opacity:.8}
  .code-box{margin-top:16px;background:#0e141a;border:1px solid #223029;border-radius:10px;padding:14px;
    word-break:break-all;font-family:monospace;font-size:13px;color:#87e8ce;white-space:pre-wrap}
  .err{color:#ff8a8a} .ok{color:#87e8ce;font-weight:600}
`;

async function handleSetupPage(req, env) {
  const url = new URL(req.url);
  const pin = url.searchParams.get("pin") || "";
  if (!env.SETUP_PIN || pin !== env.SETUP_PIN) {
    return html(`<!DOCTYPE html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>${PAGE_STYLE}</style></head>
      <body><div class="card"><h1>Watch Key Setup</h1>
      <form method=get>
        <label>PIN (set as SETUP_PIN in Worker Variables)</label>
        <input name=pin type=password autofocus>
        <button>Enter</button>
      </form></div></body></html>`);
  }
  const savedKey = (await env.STORE.get("hosted_pubkey")) || "(none yet)";
  const cfg = JSON.parse((await env.STORE.get("config")) || "{}");
  return html(`<!DOCTYPE html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>${PAGE_STYLE}</style></head>
  <body><div class="card">
    <h1>Watch Key Setup</h1>
    <p>1. Send the Client ID from developer.tesla.com to your watch (instead of typing it there). On the watch, open <b>Tesla API setup</b>, enter the domain, then on the Client ID step tap <b>Get from phone</b> to see a 6-digit code, then enter it below along with the Client ID.</p>
    <form id=cid>
      <label>Code from watch</label>
      <input name=code maxlength=6 placeholder="123456">
      <label>Client ID</label>
      <input name=clientId value="${cfg.clientId||""}">
      <button type=submit>Send to watch</button>
    </form>
    <div id=cidResult class="code-box" style="display:none"></div>

    <p style="margin-top:28px">2. On the watch, open <b>Tesla API setup &gt; View public key</b> and enter the 6-digit code it shows below.</p>
    <form id=pk>
      <label>Code from watch</label>
      <input name=code maxlength=6 placeholder="123456">
      <button type=submit>Fetch key from watch</button>
    </form>
    <div id=pkResult class="code-box">Current hosted key:\n${savedKey}</div>

    <p style="margin-top:28px">3. Fill in what Tesla gave you on developer.tesla.com, then register.</p>
    <form id=reg>
      <label>Client ID</label><input name=clientId value="${cfg.clientId||""}">
      <label>Client Secret</label><input name=clientSecret type=password>
      <label>Domain (exactly as registered, e.g. yourname.workers.dev)</label><input name=domain value="${cfg.domain||""}">
      <label>Region</label>
      <select name=region><option value=na ${cfg.region!=="eu"?"selected":""}>North America / Asia-Pacific (na)</option><option value=eu ${cfg.region==="eu"?"selected":""}>Europe / Middle East / Africa (eu)</option></select>
      <button type=submit>Register with Tesla</button>
    </form>
    <div id=regResult class="code-box" style="display:none"></div>
  </div>
  <script>
    const pin = ${JSON.stringify(pin)};
    document.getElementById('pk').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      const box = document.getElementById('pkResult');
      box.textContent = 'Fetching...';
      try {
        const r = await fetch('/api/pubkey/' + encodeURIComponent(code));
        if (!r.ok) { box.textContent = 'Not found or expired. Open the screen on the watch again for a fresh code.'; box.className='code-box err'; return; }
        const key = await r.text();
        const save = await fetch('/setup/save-key?pin=' + encodeURIComponent(pin), { method: 'POST', body: key });
        const savedText = await save.text();
        box.textContent = 'Saved as the hosted public key:\\n' + savedText;
        box.className = 'code-box ok';
      } catch (err) { box.textContent = 'Error: ' + err; box.className = 'code-box err'; }
    });
    document.getElementById('cid').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      const clientId = e.target.clientId.value.trim();
      const box = document.getElementById('cidResult');
      box.style.display = 'block'; box.className = 'code-box';
      if (!code || !clientId) { box.textContent = 'Enter both the code from the watch and the Client ID.'; box.className = 'code-box err'; return; }
      box.textContent = 'Sending...';
      try {
        const r = await fetch('/api/clientid/' + encodeURIComponent(code), { method: 'PUT', body: clientId });
        if (!r.ok) { box.textContent = 'Failed to send. Get a fresh code on the watch and try again.'; box.className = 'code-box err'; return; }
        box.textContent = 'Sent! Check the watch screen.';
        box.className = 'code-box ok';
      } catch (err) { box.textContent = 'Error: ' + err; box.className = 'code-box err'; }
    });
    document.getElementById('reg').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { clientId: f.clientId.value.trim(), clientSecret: f.clientSecret.value.trim(), domain: f.domain.value.trim(), region: f.region.value };
      const box = document.getElementById('regResult');
      box.style.display = 'block'; box.textContent = 'Registering...'; box.className = 'code-box';
      try {
        const r = await fetch('/setup/register?pin=' + encodeURIComponent(pin), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const out = await r.json();
        box.textContent = JSON.stringify(out, null, 2);
        box.className = r.ok ? 'code-box ok' : 'code-box err';
      } catch (err) { box.textContent = 'Error: ' + err; box.className = 'code-box err'; }
    });
  </script>
  </body></html>`);
}

async function handleSaveKey(req, env) {
  const url = new URL(req.url);
  if (!env.SETUP_PIN || url.searchParams.get("pin") !== env.SETUP_PIN) return text("forbidden", 403);
  const key = (await req.text()).trim();
  if (!key.includes("BEGIN PUBLIC KEY")) return text("that doesn't look like a PEM public key", 400);
  await env.STORE.put("hosted_pubkey", key);
  return text(key);
}

async function handleRegister(req, env) {
  const url = new URL(req.url);
  if (!env.SETUP_PIN || url.searchParams.get("pin") !== env.SETUP_PIN) return json({ error: "forbidden" }, 403);
  const { clientId, clientSecret, domain, region } = await req.json();
  if (!clientId || !clientSecret || !domain) return json({ error: "clientId, clientSecret and domain are required" }, 400);
  await env.STORE.put("config", JSON.stringify({ clientId, domain, region }));

  const tokenResp = await fetch("https://auth.tesla.com/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid vehicle_device_data vehicle_cmds vehicle_charging_cmds",
      audience: region === "eu"
        ? "https://fleet-api.prd.eu.vn.cloud.tesla.com"
        : "https://fleet-api.prd.na.vn.cloud.tesla.com",
    }),
  });
  const tokenJson = await tokenResp.json();
  if (!tokenResp.ok) return json({ step: "token", ...tokenJson }, tokenResp.status);

  const apiBase = region === "eu"
    ? "https://fleet-api.prd.eu.vn.cloud.tesla.com"
    : "https://fleet-api.prd.na.vn.cloud.tesla.com";
  const partnerResp = await fetch(`${apiBase}/api/1/partner_accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenJson.access_token}` },
    body: JSON.stringify({ domain }),
  });
  const partnerJson = await partnerResp.json();
  return json({ step: "partner_accounts", status: partnerResp.status, ...partnerJson }, partnerResp.ok ? 200 : partnerResp.status);
}

async function handleCallback() {
  return html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Watch Key - Tesla sign-in complete</title>
<style>${PAGE_STYLE}
.spinner{width:28px;height:28px;margin:8px auto 0;border:3px solid #223029;border-top-color:#87e8ce;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="card"><h1>Watch Key - Tesla sign-in</h1>
<div id="content"><p>Checking your sign-in...</p></div></div>
<script>
(function(){
  var params=new URLSearchParams(window.location.search);
  var code=params.get("code"), state=params.get("state"), error=params.get("error");
  var content=document.getElementById("content");
  function showManualCopy(introHtml){
    content.innerHTML = "<p>"+introHtml+"</p>"+
      '<div class="code-box">'+(code||"(no code)")+'</div>'+
      '<button onclick="navigator.clipboard&&navigator.clipboard.writeText(\\''+(code||"")+'\\')">Copy code</button>';
  }
  if(error){ content.innerHTML='<p class="err">Tesla sign-in failed: '+error+'</p>'; return; }
  if(!code){ content.innerHTML='<p class="err">No authorization code in the URL.</p>'; return; }
  if(!state){ showManualCopy("Signed in. Copy this code into the watch app."); return; }
  content.innerHTML='<p>Signed in. Sending it to your watch...</p><div class="spinner"></div>';
  fetch("/api/code/"+encodeURIComponent(state), { method:"PUT", body: code })
    .then(function(r){ if(!r.ok) throw new Error("relay failed: "+r.status);
      content.innerHTML='<p class="ok">Done! Go back to your watch.</p>'; })
    .catch(function(){ showManualCopy("Signed in. (Automatic hand-off failed, but you can still continue manually.)"); });
})();
</script></body></html>`);
}

function handlePrivacy() {
  return html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Watch Key - 개인정보처리방침 / Privacy Policy</title>
<style>${PAGE_STYLE}
  body{align-items:flex-start;padding:32px 16px}
  .card{max-width:720px;text-align:left}
  h2{font-size:16px;color:#87e8ce;margin:24px 0 8px}
  ul{padding-left:20px;color:#cdd9d4;line-height:1.6}
  li{margin-bottom:6px}
  hr{border:none;border-top:1px solid #223029;margin:28px 0}
  .updated{color:#9caeba;font-size:13px;margin-top:-4px}
</style></head><body><div class="card">
  <h1>Watch Key 개인정보처리방침</h1>
  <p class="updated">최종 업데이트: 2026년 9월 22일</p>
  <p>Watch Key(이하 "앱")는 Wear OS 스마트워치를 테슬라 차량의 디지털 키로 사용할 수 있게 해주는 앱입니다. 본 방침은 앱이 어떤 정보를 다루는지, 어떻게 사용하고 저장하는지를 설명합니다.</p>

  <h2>1. 앱이 사용하는 정보</h2>
  <ul>
    <li><b>테슬라 계정 및 차량 데이터</b>: 사용자가 직접 로그인해 연동한 테슬라 계정을 통해, 테슬라 Fleet API가 제공하는 차량 상태(배터리, 충전, 냉난방, 도어락, 위치 등)를 조회하고 잠금/해제·경적·비상등 등 명령을 전송합니다.</li>
    <li><b>블루투스(BLE) 통신</b>: 워치가 차량과 직접 BLE로 통신해 키 명령을 주고받습니다. 이 통신은 워치와 차량 사이에서만 이루어지며 외부 서버를 거치지 않습니다.</li>
    <li><b>위치 정보</b>: (1) 테슬라 서버가 제공하는 차량의 위치, (2) 워치 자체의 GPS 위치. 워치 위치는 차량과의 거리 표시, 나침반 방향 계산, 오토락(walkaway) 기능에만 사용됩니다.</li>
    <li><b>기기 센서</b>: 나침반 표시를 위해 워치의 방향 센서(회전 벡터)를 사용합니다.</li>
  </ul>

  <h2>2. 정보를 저장하거나 공유하는 방식</h2>
  <ul>
    <li>차량 데이터, 위치 정보, 테슬라 인증 토큰은 <b>사용자의 워치 기기 안에만</b> 저장되며, 개발자나 제3자의 서버에 저장되지 않습니다.</li>
    <li>본 웹사이트(Cloudflare Worker)는 테슬라 로그인 과정에서 발급되는 <b>일회성 인증 코드</b>를 워치와 휴대폰 사이에서 최대 5분간 중계하는 역할만 하며, 전달 즉시 또는 5분 후 자동으로 삭제됩니다. 이 서버는 테슬라 계정 정보, access/refresh 토큰, 차량 데이터를 저장하거나 열람하지 않습니다.</li>
    <li>수집된 정보를 광고, 마케팅 목적으로 사용하거나 제3자에게 판매·공유하지 않습니다.</li>
  </ul>

  <h2>3. 권한 사용 목적</h2>
  <ul>
    <li><b>블루투스(스캔/연결)</b>: 차량과의 직접 통신 및 오토락(walkaway) 감지</li>
    <li><b>위치</b>: 차량과의 거리·방향 표시, 오토락 감지 정확도 향상</li>
    <li><b>배터리 최적화 제외</b>: 오토락 기능이 백그라운드에서 안정적으로 동작하도록 함</li>
  </ul>

  <h2>4. 데이터 삭제</h2>
  <p>앱을 삭제하면 워치에 저장된 모든 데이터(로그인 토큰, 캐시된 차량 정보 등)가 함께 삭제됩니다. 테슬라 계정 연동을 해제하려면 테슬라 계정의 "제3자 앱" 관리 화면에서 직접 연결을 해제할 수 있습니다.</p>

  <h2>5. 문의</h2>
  <p>본 방침이나 앱의 데이터 처리 방식에 대해 문의사항이 있다면 개발자에게 연락해 주세요.</p>

  <hr>

  <h1>Watch Key Privacy Policy</h1>
  <p class="updated">Last updated: September 22, 2026</p>
  <p>Watch Key lets a Wear OS smartwatch act as a digital key for a Tesla vehicle. This policy explains what information the app handles and how it is used and stored.</p>

  <h2>1. Information the app uses</h2>
  <ul>
    <li><b>Tesla account &amp; vehicle data</b>: after the user signs in and links their own Tesla account, the app reads vehicle state (battery, charging, climate, locks, location, etc.) via the Tesla Fleet API and sends commands such as lock/unlock, honk, and flash lights.</li>
    <li><b>Bluetooth (BLE)</b>: the watch communicates directly with the vehicle over BLE to send key commands. This communication happens only between the watch and the vehicle and never passes through any external server.</li>
    <li><b>Location</b>: (1) the vehicle's location as reported by Tesla's servers, and (2) the watch's own GPS location, used only to show distance/compass direction to the vehicle and to power the walkaway auto-lock feature.</li>
    <li><b>Device sensors</b>: the watch's rotation-vector sensor is used to render the live compass.</li>
  </ul>

  <h2>2. How information is stored or shared</h2>
  <ul>
    <li>Vehicle data, location data, and Tesla auth tokens are stored <b>only on the user's own watch</b> and are never stored on the developer's or any third party's servers.</li>
    <li>This website (a Cloudflare Worker) only relays a <b>one-time Tesla sign-in code</b> between the phone and the watch for up to 5 minutes, after which it is deleted automatically (or immediately after it is retrieved). This server never stores or reads Tesla account credentials, access/refresh tokens, or vehicle data.</li>
    <li>Collected information is never used for advertising or marketing, nor sold or shared with third parties.</li>
  </ul>

  <h2>3. Why each permission is needed</h2>
  <ul>
    <li><b>Bluetooth (scan/connect)</b>: direct communication with the vehicle and walkaway detection</li>
    <li><b>Location</b>: showing distance/direction to the vehicle and improving walkaway detection accuracy</li>
    <li><b>Battery optimization exemption</b>: keeps the walkaway feature working reliably in the background</li>
  </ul>

  <h2>4. Data deletion</h2>
  <p>Uninstalling the app removes all data stored on the watch, including sign-in tokens and cached vehicle data. To revoke Tesla account access, use the "Third-Party Apps" management screen in your Tesla account.</p>

  <h2>5. Contact</h2>
  <p>If you have questions about this policy or how the app handles data, please contact the developer.</p>
</div></body></html>`);
}

async function handleHome() {
  return html(`<!DOCTYPE html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>${PAGE_STYLE}</style></head>
  <body><div class="card"><h1>Watch Key</h1><p>This site supports the Watch Key app's Tesla API connection.
  There's nothing to see here directly — open the <b>Tesla API setup</b> screen in the watch app instead.</p></div></body></html>`);
}

const APP_LANDING_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Teswatch — 워치로 여는 테슬라</title>
<meta name="description" content="구독료 없음, 계정 가입 불필요. Wear OS 워치에서 폰 없이 테슬라를 여는 키 앱, Teswatch.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0a0d12;
    --surface:#11151d;
    --surface-line:#1c2430;
    --ink:#e9eef1;
    --ink-dim:#90a0ac;
    --frunk:#2c3e50;
    --trunk:#3a3157;
    --unlock:#1f5f52;
    --charge:#35415f;
    --accent:#52b88f;
    --max:1120px;
  }
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{
    margin:0;
    background:var(--bg);
    color:var(--ink);
    font-family:"IBM Plex Sans KR","IBM Plex Sans",-apple-system,sans-serif;
    line-height:1.6;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3,.disp{
    font-family:"Archivo","IBM Plex Sans KR",sans-serif;
    letter-spacing:-0.01em;
    margin:0;
  }
  a{color:inherit;}
  .wrap{max-width:var(--max);margin:0 auto;padding:0 24px;}

  header.nav{
    position:sticky;top:0;z-index:20;
    background:rgba(10,13,18,0.82);
    backdrop-filter:blur(10px);
    border-bottom:1px solid var(--surface-line);
  }
  header.nav .wrap{
    display:flex;align-items:center;justify-content:space-between;
    height:64px;
  }
  .wordmark{font-family:"Archivo",sans-serif;font-weight:800;font-size:19px;letter-spacing:-0.02em;}
  .langtoggle{
    display:flex;border:1px solid var(--surface-line);border-radius:999px;overflow:hidden;
  }
  .langtoggle button{
    appearance:none;border:0;background:transparent;color:var(--ink-dim);
    font:500 13px/1 "IBM Plex Sans",sans-serif;padding:8px 16px;cursor:pointer;
  }
  .langtoggle button.active{background:var(--surface-line);color:var(--ink);}

  main{overflow:hidden;}

  /* ---------- hero ---------- */
  .hero{padding:72px 0 56px;}
  .hero .wrap{
    display:grid;grid-template-columns:1.05fr 0.95fr;gap:48px;align-items:center;
  }
  .hero h1{
    font-size:clamp(32px,4.2vw,50px);
    font-weight:800;
    line-height:1.14;
  }
  .hero .lede{
    margin-top:20px;font-size:17px;color:var(--ink-dim);max-width:46ch;
  }
  .badge{
    display:inline-flex;align-items:center;gap:8px;
    margin-top:28px;padding:10px 16px;
    background:rgba(82,184,143,0.1);
    border:1px solid rgba(82,184,143,0.35);
    border-radius:10px;
    font-size:14px;font-weight:500;color:var(--accent);
  }
  .badge svg{flex:none;width:16px;height:16px;}
  .cta-row{margin-top:32px;display:flex;gap:14px;flex-wrap:wrap;}
  .btn{
    display:inline-flex;align-items:center;gap:8px;
    padding:14px 22px;border-radius:10px;font-weight:600;font-size:15px;
    text-decoration:none;
  }
  .btn-primary{background:var(--ink);color:#0a0d12;}
  .btn-ghost{border:1px solid var(--surface-line);color:var(--ink);}

  /* watch illustration */
  .watch{
    position:relative;aspect-ratio:1/1;max-width:420px;margin:0 auto;
    border-radius:50%;
    background:radial-gradient(circle at 50% 36%, #161c25 0%, #080a0e 74%);
    box-shadow:inset 0 0 0 7px #161c25, inset 0 0 44px rgba(0,0,0,0.65), 0 30px 70px -20px rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
  }
  .watch .grid{
    width:78%;display:grid;grid-template-columns:1fr 1fr;gap:4%;
  }
  .watch .cell{
    aspect-ratio:1/1;border-radius:50%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:6%;
  }
  .watch .cell svg{width:46%;height:auto;}
  .watch .cell span{color:#fff;font-size:9.5px;font-weight:500;letter-spacing:-0.01em;}
  .watch .f{background:var(--frunk);}
  .watch .u{background:var(--unlock);}
  .watch .t{background:var(--trunk);}
  .watch .c{background:var(--charge);}

  /* ---------- statement ---------- */
  .statement{border-top:1px solid var(--surface-line);border-bottom:1px solid var(--surface-line);padding:40px 0;}
  .statement p{
    font-family:"Archivo",sans-serif;font-weight:700;
    font-size:clamp(20px,2.6vw,28px);text-align:center;max-width:720px;margin:0 auto;
  }

  /* ---------- tiers ---------- */
  .tiers{padding:84px 0;}
  .tiers > .wrap > h2{
    font-size:clamp(24px,3vw,34px);font-weight:800;max-width:14em;
  }
  .tiers > .wrap > p.sub{color:var(--ink-dim);margin-top:14px;max-width:60ch;font-size:16px;}
  .tier-list{margin-top:48px;display:flex;flex-direction:column;}
  .tier{
    display:grid;grid-template-columns:72px 1fr;gap:24px;
    padding:32px 0;border-top:1px solid var(--surface-line);
  }
  .tier:last-child{border-bottom:1px solid var(--surface-line);}
  .tier .num{
    font-family:"Archivo",sans-serif;font-weight:800;font-size:28px;color:var(--ink-dim);
  }
  .tier h3{font-size:19px;font-weight:700;}
  .tier .tag{
    display:inline-block;margin-left:10px;padding:3px 10px;border-radius:999px;
    font-size:11.5px;font-weight:500;vertical-align:middle;
  }
  .tier.req .tag{background:rgba(82,184,143,0.14);color:var(--accent);}
  .tier.opt .tag{background:rgba(144,160,172,0.14);color:var(--ink-dim);}
  .tier p{margin-top:10px;color:var(--ink-dim);font-size:15.5px;max-width:62ch;}
  .tier .req-note{margin-top:10px;font-size:13.5px;color:#d0a25e;}

  /* ---------- footer ---------- */
  footer{border-top:1px solid var(--surface-line);padding:40px 0;}
  footer .wrap{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center;}
  footer .links{display:flex;gap:24px;font-size:14px;color:var(--ink-dim);flex-wrap:wrap;}
  footer .links a:hover{color:var(--ink);}
  footer .copy{font-size:13px;color:var(--ink-dim);}

  @media (max-width:860px){
    .hero .wrap{grid-template-columns:1fr;}
    .hero{padding:48px 0 40px;text-align:left;}
    .watch{max-width:300px;margin-top:8px;}
    .tier{grid-template-columns:44px 1fr;}
  }

  [data-en]{display:none;}
  html[data-lang="en"] [data-ko]{display:none;}
  html[data-lang="en"] [data-en]{display:inline;}
  html[data-lang="en"] [data-en-block]{display:block;}

  @media (prefers-reduced-motion: no-preference){
    .watch{animation:rise 0.7s ease-out both;}
  }
  @keyframes rise{from{opacity:0;transform:translateY(14px) scale(0.98);}to{opacity:1;transform:none;}}
</style>
</head>
<body>

<header class="nav">
  <div class="wrap">
    <div class="wordmark">Teswatch</div>
    <div class="langtoggle" role="group" aria-label="Language">
      <button type="button" id="btn-ko" class="active" onclick="setLang('ko')">한국어</button>
      <button type="button" id="btn-en" onclick="setLang('en')">English</button>
    </div>
  </div>
</header>

<main>

  <section class="hero">
    <div class="wrap">
      <div>
        <h1>
          <span data-ko>폰 없이, 손목에서<br>테슬라를 엽니다</span>
          <span data-en>Open your Tesla<br>from your wrist. No phone.</span>
        </h1>
        <p class="lede">
          <span data-ko>Teswatch는 Wear OS 워치 전용 테슬라 키 앱입니다. 워치와 차량이 블루투스로 직접 연결돼, 트렁크·프렁크·충전구·잠금을 손목에서 바로 조작합니다.</span>
          <span data-en>Teswatch is a Tesla key app built for Wear OS. Your watch connects to the car directly over Bluetooth — control the trunk, frunk, charge port, and locks right from your wrist.</span>
        </p>
        <div class="badge">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span data-ko>구독료 없음 · 계정 가입 불필요</span>
          <span data-en>No subscription. No account.</span>
        </div>
        <div class="cta-row">
          <a class="btn btn-primary" href="#download">
            <span data-ko>Play 스토어에서 받기</span>
            <span data-en>Get it on Google Play</span>
          </a>
          <a class="btn btn-ghost" href="#how">
            <span data-ko>작동 방식 보기</span>
            <span data-en>See how it works</span>
          </a>
        </div>
      </div>

      <div class="watch" aria-hidden="true">
        <div class="grid">
          <div class="cell f">
            <svg viewBox="0 0 394 329" fill="none"><g stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="18,207 19,203 20,199 20,195 21,191 24,187 27,183 31,179 35,176 39,173 43,170 47,168 51,166 55,163 59,161 63,160 67,158 71,156 75,155 79,153 83,152 87,151 91,149 95,148 99,147 103,146 107,144 111,143 115,142 119,141 123,140 127,139 131,138 135,138 139,137 143,136 147,135 151,135 155,134 159,133 163,133 167,132 171,132 175,131 179,131 183,130 187,129 191,128 195,127 199,126 203,125 207,123 211,121 215,119 219,116 223,112 227,109 231,106 235,103 239,100 243,96 247,93 251,90 255,87 259,84 263,82 267,79 271,76 275,74 279,71 283,69 287,67 291,65 295,63 299,62 303,60 307,59 311,57 315,56 319,55 323,54 327,53 331,52 335,51 339,50 343,49 347,49 351,48 355,48 359,47 363,47 367,46 371,46 375,46 379,46 383,46 386,45"/>
              <polyline points="78,281 76,282 74,281 72,281 70,281 68,281 66,281 64,281 62,281 60,281 58,281 56,281 54,281 52,280 50,280 48,280 46,280 44,280 42,280 40,280 38,280 36,280 34,279 32,279 30,278 28,278 26,277 24,277 22,276 20,275 18,275 16,273 14,271 12,269 11,267 10,265 10,263 9,261 9,259 9,257 9,255 9,253 8,251 8,249 8,247 8,245 9,243 9,241 9,239 9,237 9,235 10,233 10,231 10,229 10,227 11,225 11,223 11,221 12,219 12,217 13,215 13,213 14,211 15,209 17,208"/>
              <polyline points="19,208 21,208 23,208 25,208 27,208 29,208 31,208 33,208 35,208 37,207 39,207 41,207 43,207 45,207 47,206 49,206 51,205 53,205 55,204 57,203 59,202 61,201 63,200 65,199 67,198 69,197 71,195 73,194 75,192 77,191 79,189 81,188 83,186"/>
              <polyline points="363,281 362,282 361,282 360,281 359,281 358,281 357,281 356,281 355,281 354,281 353,281 352,281 351,281 350,281 349,281 348,281 347,281 346,281 345,281 344,281 343,281 342,281 341,281 340,281 339,281 338,281 337,281 336,281 335,281 334,281 333,281 332,281 331,281 330,281 329,281 328,281 327,281 326,281 325,281 324,281 323,281 322,281 321,281 320,281 319,281 318,281 317,281 316,281 315,281 314,281 313,281 312,281 311,281 310,281 309,281 308,281 307,281 306,281 305,281 304,281 303,281 302,281 301,281 300,281 299,281 298,281 297,281 296,281 295,281 294,281 293,281 292,281 291,281 290,281 289,281 288,281 287,281 286,281 285,281 284,281 283,281 282,281 281,281 280,281 279,281 278,281 277,281 276,282 275,282 274,281"/>
              <polygon points="149,314 145,311 141,308 137,304 133,300 130,296 127,292 125,288 123,284 122,280 121,276 120,272 120,268 120,264 120,260 120,256 121,252 122,248 123,244 124,240 126,236 128,232 131,228 134,224 138,220 142,217 146,214 150,211 154,209 158,208 162,206 166,205 170,204 174,204 178,204 182,204 186,204 190,205 194,206 198,207 202,208 206,210 210,212 214,215 218,218 222,222 225,226 229,230 231,234 233,238 235,242 236,246 237,250 238,254 238,258 239,262 239,266 238,270 237,274 237,278 235,282 234,286 232,290 230,294 227,298 223,302 219,306 215,310 211,313 207,315 203,317 199,318 195,320 191,320 187,321 183,321 179,321 175,321 171,321 167,320 163,320 159,318 155,317 151,315 149,314" fill="none"/>
            </g></svg>
            <span data-ko>프렁크</span><span data-en>Frunk</span>
          </div>
          <div class="cell u">
            <svg viewBox="0 0 100 100" fill="none"><path d="M32 46V33a18 18 0 0136 0v13" stroke="#fff" stroke-width="9" stroke-linecap="round"/><rect x="24" y="46" width="52" height="38" rx="9" fill="#fff"/></svg>
            <span data-ko>차량</span><span data-en>Vehicle</span>
          </div>
          <div class="cell t">
            <svg viewBox="0 0 178 156" fill="none"><g stroke="#fff" stroke-width="7.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="8,37 9,37 10,37 11,37 12,37 13,37 14,37 15,37 16,37 17,37 18,37 19,37 20,37 21,37 22,37 23,37 24,37 25,37 26,37 27,37 28,37 29,37 30,37 31,38 32,38 33,38 34,38 35,38 36,38 37,38 38,38 39,39 40,39 41,39 42,39 43,39 44,39 45,39 46,39 47,40 48,40 49,40 50,40 51,40 52,40 53,41 54,41 55,41 56,41 57,41 58,42 59,42 60,42 61,42 62,42 63,43 64,43 65,43 66,43 67,44 68,44 69,44 70,44 71,45 72,45 73,45 74,46 75,46 76,46 77,46 78,47 79,47 80,47 81,48 82,48 83,48 84,48 85,49 86,49 87,50 88,50 89,50 90,51 91,51 92,52 93,52 94,52 95,53 96,53 97,53 98,54 99,54 100,55 101,55 102,56 103,56 104,57 105,57 106,57 107,58 108,58 109,59 110,59 111,59 112,60 113,60 114,61 115,61 116,62 117,62 118,63 119,63 120,64 121,64 122,65 123,65 124,66 125,66 126,67 127,67 128,68 129,68 130,69 131,69 132,70 133,70 134,71 135,71 136,72 137,72 138,73 139,73 140,74 141,75 141,76 142,77 143,78 143,79 143,80 143,81 144,82 144,83 144,84 144,85 144,86 144,87"/>
              <polyline points="123,85 124,86 125,86 126,87 127,87 128,87 129,87 130,87 131,88 132,88 133,88 134,88 135,88 136,88 137,88 138,88 139,88 140,88 141,88 142,88 143,88"/>
              <polyline points="145,88 146,89 147,90 147,91 148,92 148,93 148,94 149,95 149,96 149,97 150,98 150,99 151,100 151,101 152,102 152,103 153,104 153,105 153,106 153,107 154,108 154,109 154,110 154,111 154,112 154,113 154,114 154,115 154,116 154,117 154,118 154,119 154,120 154,121 154,122 153,123 153,124 153,125 152,126 151,127 150,128 149,129 148,129 147,129 146,130 145,130 144,130 143,130 142,131 141,131 140,131 139,131 138,131 137,131 136,131 135,131 134,131 133,131 132,131 131,131 130,131"/>
              <polyline points="58,130 57,130 56,131 55,131 54,131 53,131 52,131 51,131 50,131 49,131 48,131 47,131 46,131 45,131 44,131 43,131 42,131 41,131 40,131 39,131 38,131 37,131 36,131 35,131 34,131 33,131 32,131 31,131 30,131 29,131 28,131 27,131 26,131 25,131 24,131 23,131 22,131 21,131 20,131 19,131 18,131"/>
              <polygon points="94,98 93,99 92,99 91,99 90,99 89,99 88,99 87,100 86,100 85,100 84,101 83,101 82,102 81,102 80,103 79,104 78,105 77,106 76,107 75,108 74,109 73,110 73,111 72,112 71,113 71,114 71,115 70,116 70,117 70,118 70,119 70,120 70,121 70,122 69,123 69,124 69,125 70,126 70,127 70,128 70,129 70,130 70,131 70,132 71,133 71,134 72,135 72,136 73,137 74,138 74,139 75,140 76,141 77,142 78,143 79,143 80,144 81,145 82,145 83,146 84,146 85,146 86,147 87,147 88,148 89,148 90,148 91,148 92,148 93,148 94,148 95,148 96,148 97,148 98,148 99,148 100,147 101,147 102,147 103,146 104,146 105,146 106,145 107,144 108,144 109,143 110,142 111,141 112,140 113,139 114,138 114,137 115,136 115,135 116,134 116,133 117,132 117,131 117,130 118,129 118,128 118,127 118,126 118,125 118,124 118,123 118,122 118,121 118,120 118,119 118,118 117,117 117,116 117,115 116,114 116,113 115,112 115,111 114,110 114,109 113,108 112,107 111,106 110,105 109,104 108,103 107,102 106,102 105,101 104,101 103,101 102,100 101,100 100,100 99,99 98,99 97,99 96,99 95,99 94,98" fill="none"/>
            </g></svg>
            <span data-ko>트렁크</span><span data-en>Trunk</span>
          </div>
          <div class="cell c">
            <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 L4.5 13.5 L11 13.5 L9.5 22 L19.5 9.5 L12.5 9.5 Z" fill="#fff"/></svg>
            <span data-ko>충전구</span><span data-en>Charge</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="statement">
    <div class="wrap">
      <p>
        <span data-ko>한 번 구매로 끝. 월 구독료도, 회원가입도, 서버에 남는 개인정보도 없습니다.</span>
        <span data-en>Buy once, done. No monthly fee, no sign-up, nothing stored on a server.</span>
      </p>
    </div>
  </section>

  <section class="tiers" id="how">
    <div class="wrap">
      <h2>
        <span data-ko>필요한 만큼만 연결하세요</span>
        <span data-en>Connect only as much as you need</span>
      </h2>
      <p class="sub">
        <span data-ko>기본 기능은 설치 즉시 동작합니다. 더 쓰고 싶을 때만 다음 단계를 추가하면 됩니다.</span>
        <span data-en>The basics work the moment you install it. Add the next step only if you want more.</span>
      </p>

      <div class="tier-list">
        <div class="tier req">
          <div class="num">01</div>
          <div>
            <h3>
              <span data-ko>BLE 직결</span><span data-en>Direct Bluetooth</span>
              <span class="tag"><span data-ko>기본</span><span data-en>Included</span></span>
            </h3>
            <p>
              <span data-ko>워치와 차량이 블루투스로 바로 연결됩니다. 폰 없이, 차량 근처에서 잠금·해제, 트렁크·프렁크 열기, 충전구 조작이 가능합니다. 주행도 가능합니다.</span>
              <span data-en>Your watch talks to the car directly over Bluetooth. Near the car, with no phone: lock and unlock, open the trunk and frunk, and work the charge port. You can also drive with it.</span>
            </p>
          </div>
        </div>

        <div class="tier req">
          <div class="num">02</div>
          <div>
            <h3>
              <span data-ko>카드키 대체</span><span data-en>Card key replacement</span>
              <span class="tag"><span data-ko>기본</span><span data-en>Included</span></span>
            </h3>
            <p>
              <span data-ko>테슬라가 제공하는 정품 카드키와 동일한 방식으로 동작합니다. 별도 설정 없이 바로 씁니다.</span>
              <span data-en>Works the same way as Tesla's own card key, out of the box — no extra setup.</span>
            </p>
          </div>
        </div>

        <div class="tier opt">
          <div class="num">03</div>
          <div>
            <h3>
              <span data-ko>Tesla API 연동</span><span data-en>Tesla API connection</span>
              <span class="tag"><span data-ko>선택</span><span data-en>Optional</span></span>
            </h3>
            <p>
              <span data-ko>인터넷을 통해 01번 기능은 물론, 공조기, 배터리 상태, 경적·플래시, 차량 위치까지 확인할 수 있습니다.</span>
              <span data-en>Over the internet, you get everything in step 01 plus climate control, battery status, horn and flash, and vehicle location.</span>
            </p>
            <p class="req-note">
              <span data-ko>* Cloudflare, GitHub, Tesla 개발자 계정이 필요합니다. 본인 소유 계정만 사용하며, 앱 서버에 정보가 저장되지 않습니다.</span>
              <span data-en>* Requires your own Cloudflare, GitHub, and Tesla Developer accounts. Only your own accounts are used — nothing is stored on an app server.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

</main>

<footer id="download">
  <div class="wrap">
    <div class="copy">© 2026 Teswatch</div>
    <div class="links">
      <a href="/privacy">
        <span data-ko>개인정보처리방침</span><span data-en>Privacy Policy</span>
      </a>
      <a href="mailto:fate1048@gmail.com">
        <span data-ko>문의하기</span><span data-en>Contact</span>
      </a>
      <a href="#" id="play-link">
        <span data-ko>Play 스토어</span><span data-en>Google Play</span>
      </a>
    </div>
  </div>
</footer>

<script>
  function setLang(lang){
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.setAttribute('lang', lang);
    document.getElementById('btn-ko').classList.toggle('active', lang==='ko');
    document.getElementById('btn-en').classList.toggle('active', lang==='en');
    try { localStorage.setItem('teswatch-lang', lang); } catch(e) {}
  }
  (function(){
    var saved = null;
    try { saved = localStorage.getItem('teswatch-lang'); } catch(e) {}
    if (saved === 'en') setLang('en');
  })();
</script>

</body>
</html>
`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const { pathname } = url;
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (pathname === "/" ) return handleHome();
    if (pathname === "/privacy") return Response.redirect("https://lazycompany.app/teswatch/privacy", 301);
    if (pathname === "/callback") return handleCallback();
    if (pathname === "/setup" && req.method === "GET") return handleSetupPage(req, env);
    if (pathname === "/setup/save-key" && req.method === "POST") return handleSaveKey(req, env);
    if (pathname === "/setup/register" && req.method === "POST") return handleRegister(req, env);

    if (pathname === "/.well-known/appspecific/com.tesla.3p.public-key.pem") {
      const key = await env.STORE.get("hosted_pubkey");
      if (!key) return text("not set up yet", 404);
      return text(key, 200, { "Access-Control-Allow-Origin": "*" });
    }

    let m = pathname.match(/^\/api\/code\/([^/]+)$/);
    if (m) {
      const key = "code:" + m[1];
      if (req.method === "PUT") { await env.STORE.put(key, await req.text(), { expirationTtl: 300 }); return text("ok", 200, CORS); }
      if (req.method === "GET") { const v = await env.STORE.get(key); return v ? text(v, 200, CORS) : new Response(null, { status: 204, headers: CORS }); }
    }
    m = pathname.match(/^\/api\/pubkey\/([^/]+)$/);
    if (m) {
      const key = "pubkey:" + m[1];
      if (req.method === "PUT") { await env.STORE.put(key, await req.text(), { expirationTtl: 300 }); return text("ok", 200, CORS); }
      if (req.method === "GET") { const v = await env.STORE.get(key); return v ? text(v, 200, CORS) : new Response(null, { status: 204, headers: CORS }); }
    }
    m = pathname.match(/^\/api\/clientid\/([^/]+)$/);
    if (m) {
      const key = "clientid:" + m[1];
      if (req.method === "PUT") { await env.STORE.put(key, await req.text(), { expirationTtl: 300 }); return text("ok", 200, CORS); }
      if (req.method === "GET") { const v = await env.STORE.get(key); return v ? text(v, 200, CORS) : new Response(null, { status: 204, headers: CORS }); }
    }

    return text("not found", 404);
  },
};
