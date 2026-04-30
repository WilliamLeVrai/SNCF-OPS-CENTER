const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2] || "92533e5d-2dde-413e-87b7-5a5e9ff529de";
const PORT    = process.env.PORT || 3333;
const pad     = n => String(n).padStart(2, "0");
const ts      = () => new Date().toLocaleTimeString("fr-FR");
const log     = (e, m) => console.log("[" + ts() + "] " + e + "  " + m);

function sncfGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.sncf.com",
      path: "/v1/coverage/sncf/" + path,
      headers: {
        Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64"),
        Accept: "application/json",
      },
    };
    https.get(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("JSON invalide")); }
      });
    }).on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path   = parsed.pathname;
  const q      = parsed.query;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML);
    return;
  }

  res.setHeader("Content-Type", "application/json");

  if (path === "/api/places") {
    log("🔍", "Recherche: " + q.q);
    try {
      const data = await sncfGet("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area&count=8");
      log("✅", (data.places||[]).length + " gare(s)");
      res.end(JSON.stringify(data));
    } catch(e) { log("❌", e.message); res.end(JSON.stringify({error: e.message})); }
    return;
  }

  if (path === "/api/departures") {
    const now = new Date();
    const dt  = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + "T" + pad(now.getHours()) + pad(now.getMinutes()) + "00";
    log("🚄", "Departs: " + q.stop);
    try {
      const data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?from_datetime=" + dt + "&count=40&data_freshness=realtime&depth=2");
      log("✅", (data.departures||[]).length + " depart(s)");
      res.end(JSON.stringify(data));
    } catch(e) { log("❌", e.message); res.end(JSON.stringify({error: e.message})); }
    return;
  }

  if (path === "/api/arrivals") {
    const now = new Date();
    const dt  = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + "T" + pad(now.getHours()) + pad(now.getMinutes()) + "00";
    log("🚉", "Arrivees: " + q.stop);
    try {
      const data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?from_datetime=" + dt + "&count=40&data_freshness=realtime&depth=2");
      log("✅", (data.arrivals||[]).length + " arrivee(s)");
      res.end(JSON.stringify(data));
    } catch(e) { log("❌", e.message); res.end(JSON.stringify({error: e.message})); }
    return;
  }

  if (path === "/api/vehicle") {
    log("🛑", "Trajet: " + (q.id||"").slice(-20));
    try {
      const data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=realtime");
      log("✅", (data.vehicle_journeys&&data.vehicle_journeys[0]&&data.vehicle_journeys[0].stop_times&&data.vehicle_journeys[0].stop_times.length||0) + " arret(s)");
      res.end(JSON.stringify(data));
    } catch(e) { log("❌", e.message); res.end(JSON.stringify({error: e.message})); }
    return;
  }

  if (path === "/api/disruptions") {
    log("⚠️", "Perturbations reseau");
    try {
      const data = await sncfGet("disruptions?count=50&depth=1");
      log("✅", (data.disruptions||[]).length + " perturbation(s)");
      res.end(JSON.stringify(data));
    } catch(e) { log("❌", e.message); res.end(JSON.stringify({error: e.message})); }
    return;
  }


  if (path === "/api/schedules") {
    const now = new Date();
    const dt  = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + "T" + pad(now.getHours()) + pad(now.getMinutes()) + "00";
    try {
      const data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/stop_schedules?from_datetime=" + dt + "&data_freshness=realtime&items_per_schedule=3&depth=2");
      res.end(JSON.stringify(data));
    } catch(e) { res.end(JSON.stringify({error: e.message})); }
    return;
  }

  if (path === "/api/lines") {
    try {
      const data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/lines?depth=2");
      res.end(JSON.stringify(data));
    } catch(e) { res.end(JSON.stringify({error: e.message})); }
    return;
  }

  if (path === "/api/journeys") {
    const now = new Date();
    const dt  = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + "T" + pad(now.getHours()) + pad(now.getMinutes()) + "00";
    try {
      const data = await sncfGet("journeys?from=" + encodeURIComponent(q.from) + "&to=" + encodeURIComponent(q.to) + "&datetime=" + dt + "&count=3&data_freshness=realtime");
      res.end(JSON.stringify(data));
    } catch(e) { res.end(JSON.stringify({error: e.message})); }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error: "Not found"}));
});

server.listen(PORT, async () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚄  SNCF Operations Center");
  console.log("🌐  http://localhost:" + PORT);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⏳  Test connexion SNCF...");
  try {
    const d = await sncfGet("places?q=paris&type[]=stop_area&count=1");
    if (d.places) console.log("✅  API SNCF OK ! Ouvre http://localhost:" + PORT + "\n");
    else console.log("⚠️  Reponse inattendue");
  } catch(e) { console.log("❌  Erreur:", e.message); }
  console.log("📋  Les requetes s'afficheront ici.\n");
});

const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNCF OPS CENTER</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #04070e;
  --panel: #070d18;
  --card: #0b1422;
  --card2: #0e1928;
  --border: #13253d;
  --border2: #1a3354;
  --text: #ccd9ee;
  --muted: #3d5475;
  --blue: #2f80ed;
  --blue2: #56a0f5;
  --cyan: #00c2d4;
  --green: #00e676;
  --green2: #1de9b6;
  --orange: #ff9100;
  --red: #ff1744;
  --yellow: #ffd600;
  --purple: #7c4dff;
  --tgv: #c0092a;
  --ter: #e6007e;
  --inter: #0088ce;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: "DM Sans", sans-serif;
  display: flex;
  flex-direction: column;
}

/* ── TOPBAR ── */
.topbar {
  height: 52px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 24px;
  flex-shrink: 0;
  position: relative;
  z-index: 20;
}
.topbar-logo {
  font-family: "Bebas Neue", sans-serif;
  font-size: 1.3rem;
  letter-spacing: .1em;
  color: var(--blue2);
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.topbar-logo span { color: var(--text); }
.topbar-clock {
  font-family: "JetBrains Mono", monospace;
  font-size: .9rem;
  color: var(--cyan);
  letter-spacing: .05em;
  white-space: nowrap;
}
.topbar-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: .7rem;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.status-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--green);
  animation: blink 2s ease infinite;
}
.topbar-search {
  flex: 1;
  max-width: 360px;
  position: relative;
}
.topbar-search input {
  width: 100%;
  background: var(--card);
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 8px 36px 8px 14px;
  color: var(--text);
  font-size: .85rem;
  font-family: "DM Sans", sans-serif;
  outline: none;
  transition: border-color .2s, box-shadow .2s;
}
.topbar-search input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(47,128,237,.15);
}
.topbar-search input::placeholder { color: var(--muted); }
.search-icon {
  position: absolute; right: 11px; top: 50%;
  transform: translateY(-50%);
  font-size: .9rem; color: var(--muted);
  pointer-events: none;
}
.spin-sm {
  position: absolute; right: 11px; top: 50%;
  transform: translateY(-50%);
  width: 14px; height: 14px;
  border: 2px solid var(--border2);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: spin .7s linear infinite;
  display: none;
}
.spin-sm.on { display: block; }
.suggestions {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 100;
  background: #0a1525;
  border: 1px solid var(--border2);
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0,0,0,.8);
  overflow: hidden;
  display: none;
}
.suggestions.on { display: block; }
.sug {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  font-size: .85rem;
  transition: background .1s;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sug:last-child { border-bottom: none; }
.sug:hover { background: #112038; }
.sug-icon { color: var(--blue2); font-size: .8rem; }
.sug-name { color: var(--text); }
.sug-region { color: var(--muted); font-size: .7rem; margin-left: auto; }

.topbar-tabs {
  display: flex;
  gap: 2px;
  margin-left: auto;
}
.tab {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: .72rem;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  cursor: pointer;
  color: var(--muted);
  transition: all .15s;
  border: 1px solid transparent;
}
.tab:hover { color: var(--text); background: var(--card); }
.tab.active {
  color: var(--blue2);
  background: rgba(47,128,237,.12);
  border-color: rgba(47,128,237,.3);
}
.tab .tab-count {
  display: inline-block;
  background: var(--red);
  color: #fff;
  border-radius: 10px;
  padding: 1px 5px;
  font-size: .6rem;
  margin-left: 4px;
  vertical-align: middle;
}

/* ── MAIN LAYOUT ── */
.workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── SIDEBAR ── */
.sidebar {
  width: 380px;
  min-width: 380px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sidebar-header {
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sidebar-title {
  font-size: .62rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
.kpi-row {
  display: flex;
  gap: 6px;
}
.kpi {
  flex: 1;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 10px;
  text-align: center;
}
.kpi-n {
  font-family: "JetBrains Mono", monospace;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1;
}
.kpi-l { font-size: .58rem; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: .06em; }
.kpi.ok .kpi-n { color: var(--green); }
.kpi.warn .kpi-n { color: var(--orange); }
.kpi.danger .kpi-n { color: var(--red); }
.kpi.info .kpi-n { color: var(--blue2); }

.trains-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}
.trains-list::-webkit-scrollbar { width: 3px; }
.trains-list::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

/* Train card */
.tcard {
  background: var(--card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--blue);
  border-radius: 8px;
  padding: 11px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: background .15s, transform .1s, box-shadow .15s;
  animation: fadeUp .25s ease both;
  position: relative;
  overflow: hidden;
}
.tcard::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.02) 0%, transparent 60%);
  pointer-events: none;
}
.tcard:hover {
  background: var(--card2);
  transform: translateX(3px);
  box-shadow: 0 4px 20px rgba(0,0,0,.4);
}
.tcard.selected {
  background: #0f1e35;
  border-color: var(--blue);
  box-shadow: 0 0 0 1px rgba(47,128,237,.3);
}
.tcard.late { border-left-color: var(--orange); }
.tcard.very-late { border-left-color: var(--red); }
.tcard.cancelled { border-left-color: var(--red); opacity: .6; }

.tcard-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.tcard-left { flex: 1; min-width: 0; }
.tcard-right { text-align: right; flex-shrink: 0; }

.mode-chip {
  display: inline-block;
  font-family: "JetBrains Mono", monospace;
  font-size: .58rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: .1em;
  margin-right: 5px;
  vertical-align: middle;
}
.train-num {
  font-family: "JetBrains Mono", monospace;
  font-weight: 700;
  font-size: .9rem;
  vertical-align: middle;
}
.train-dir {
  font-size: .78rem;
  color: #6a8aaa;
  margin: 3px 0 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.badge {
  font-size: .6rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 20px;
  white-space: nowrap;
}
.b-ok     { background: rgba(0,230,118,.08); color: var(--green); border: 1px solid rgba(0,230,118,.2); }
.b-late   { background: rgba(255,145,0,.08); color: var(--orange); border: 1px solid rgba(255,145,0,.2); }
.b-cancel { background: rgba(255,23,68,.08); color: var(--red); border: 1px solid rgba(255,23,68,.2); }
.b-cause  { color: var(--muted); font-size: .58rem; }
.b-mat    { color: #3d5475; font-size: .58rem; font-style: italic; }

.dep-time {
  font-family: "JetBrains Mono", monospace;
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -.02em;
}
.dep-base {
  font-family: "JetBrains Mono", monospace;
  font-size: .68rem;
  color: var(--muted);
  text-decoration: line-through;
}
.voie-badge {
  display: inline-block;
  margin-top: 4px;
  background: #0f2040;
  color: #5ba3f5;
  border: 1px solid #1a3566;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: .68rem;
  font-family: "JetBrains Mono", monospace;
  font-weight: 700;
}

/* ── DETAIL PANEL ── */
.detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* View switcher */
.view-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  padding: 0 20px;
  flex-shrink: 0;
}
.view-tab {
  padding: 12px 16px;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all .15s;
  display: none;
}
.view-tab.visible { display: block; }
.view-tab:hover { color: var(--text); }
.view-tab.active { color: var(--blue2); border-bottom-color: var(--blue2); }

.view { display: none; flex: 1; overflow-y: auto; }
.view.active { display: block; }
.view::-webkit-scrollbar { width: 4px; }
.view::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

/* ── DETAIL TRAIN ── */
#view-train {
  padding: 0;
}
.train-hero {
  padding: 28px 32px 20px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(135deg, #07111f 0%, var(--bg) 100%);
  position: relative;
  overflow: hidden;
}
.train-hero::before {
  content: attr(data-num);
  position: absolute;
  right: -10px; top: -20px;
  font-family: "Bebas Neue", sans-serif;
  font-size: 9rem;
  color: rgba(255,255,255,.025);
  pointer-events: none;
  user-select: none;
  line-height: 1;
}
.hero-num {
  font-family: "Bebas Neue", sans-serif;
  font-size: 4rem;
  line-height: 1;
  letter-spacing: .02em;
  margin-bottom: 4px;
}
.hero-dir { font-size: 1rem; color: #6a8aaa; margin-bottom: 14px; }
.hero-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.hero-badge {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: .72rem;
  font-weight: 700;
  border: 1px solid;
}

.disruption-alert {
  margin: 16px 32px;
  background: rgba(255,23,68,.07);
  border: 1px solid rgba(255,23,68,.25);
  border-left: 3px solid var(--red);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: .82rem;
  color: #ff8a9a;
  display: none;
}
.disruption-alert.on { display: block; }
.disruption-alert strong { color: var(--red); display: block; margin-bottom: 4px; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; }

/* Delay chart */
.delay-chart-wrap {
  margin: 16px 32px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  display: none;
}
.delay-chart-wrap.on { display: block; }
.delay-chart-title {
  font-size: .62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--muted);
  margin-bottom: 12px;
}
.delay-chart { position: relative; height: 60px; }
.delay-bars { display: flex; align-items: flex-end; gap: 3px; height: 100%; }
.delay-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; position: relative; }
.delay-bar {
  width: 100%;
  border-radius: 3px 3px 0 0;
  min-height: 2px;
  transition: opacity .2s;
  cursor: default;
}
.delay-bar:hover { opacity: .8; }
.delay-bar-label {
  position: absolute;
  bottom: -16px;
  font-size: .45rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 30px;
  text-align: center;
}

/* Timeline */
.timeline {
  padding: 20px 32px 40px;
}
.tl-stop {
  display: flex;
  gap: 14px;
  animation: fadeUp .2s ease both;
}
.tl-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 14px;
  flex-shrink: 0;
  padding-top: 5px;
}
.tl-dot {
  width: 9px; height: 9px;
  border-radius: 50%;
  border: 2px solid var(--border2);
  background: var(--bg);
  flex-shrink: 0;
  transition: all .2s;
}
.tl-dot.first { background: var(--green2); border-color: var(--green2); box-shadow: 0 0 8px rgba(29,233,182,.5); }
.tl-dot.last  { background: var(--red); border-color: var(--red); box-shadow: 0 0 8px rgba(255,23,68,.5); }
.tl-dot.impacted { border-color: var(--orange); box-shadow: 0 0 6px rgba(255,145,0,.4); }
.tl-dot.origin { background: var(--red); border-color: var(--red); box-shadow: 0 0 10px rgba(255,23,68,.6); }
.tl-seg { width: 1px; flex: 1; min-height: 18px; background: var(--border); margin: 2px 0; }
.tl-seg.impacted { background: rgba(255,145,0,.3); }

.tl-content {
  flex: 1;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.tl-stop:last-child .tl-content { border-bottom: none; }
.tl-name { font-size: .88rem; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.tl-incident { font-size: .58rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--red); margin-bottom: 4px; }
.tl-times { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tl-time { font-family: "JetBrains Mono", monospace; font-size: .9rem; font-weight: 500; color: var(--blue2); }
.tl-base { font-family: "JetBrains Mono", monospace; font-size: .72rem; color: var(--muted); text-decoration: line-through; }
.tl-delay { font-size: .68rem; font-weight: 700; color: var(--orange); }
.tl-catch { font-size: .62rem; font-weight: 700; color: var(--green2); background: rgba(29,233,182,.08); padding: 1px 6px; border-radius: 10px; }
.tl-voie { font-family: "JetBrains Mono", monospace; font-size: .65rem; background: #0f2040; color: #5ba3f5; border: 1px solid #1a3566; padding: 1px 6px; border-radius: 4px; margin-left: auto; }

/* ── DEPARTURES BOARD (grand tableau) ── */
#view-board {
  background: #02050c;
  padding: 20px;
}
.board-title {
  font-family: "Bebas Neue", sans-serif;
  font-size: 1.2rem;
  letter-spacing: .15em;
  color: var(--cyan);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.board-table { width: 100%; border-collapse: collapse; }
.board-table th {
  font-size: .58rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.board-table td {
  padding: 10px 10px;
  border-bottom: 1px solid #0b1525;
  font-size: .82rem;
  vertical-align: middle;
}
.board-table tr:hover td { background: #060d1a; }
.board-time { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 1.1rem; }
.board-delay { font-family: "JetBrains Mono", monospace; font-size: .78rem; color: var(--orange); }
.board-dest { font-weight: 600; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-voie { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 1rem; color: #5ba3f5; }
.board-status-ok     { color: var(--green); font-size: .7rem; font-weight: 700; }
.board-status-late   { color: var(--orange); font-size: .7rem; font-weight: 700; }
.board-status-cancel { color: var(--red); font-size: .7rem; font-weight: 700; }

/* ── DISRUPTIONS VIEW ── */
#view-disruptions { padding: 20px; }
.disrup-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--orange);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 10px;
  animation: fadeUp .2s ease both;
}
.disrup-card.severe { border-left-color: var(--red); }
.disrup-title { font-weight: 700; font-size: .88rem; margin-bottom: 4px; color: var(--text); }
.disrup-meta { font-size: .7rem; color: var(--muted); margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap; }
.disrup-msg { font-size: .78rem; color: #8899aa; line-height: 1.5; }
.disrup-effect {
  display: inline-block;
  font-size: .6rem; font-weight: 700;
  padding: 2px 7px; border-radius: 20px;
  margin-top: 6px;
}
.effect-delay  { background: rgba(255,145,0,.1); color: var(--orange); border: 1px solid rgba(255,145,0,.2); }
.effect-stop   { background: rgba(255,23,68,.1); color: var(--red); border: 1px solid rgba(255,23,68,.2); }
.effect-normal { background: rgba(0,230,118,.1); color: var(--green); border: 1px solid rgba(0,230,118,.2); }

/* ── ARRIVALS ── */
#view-arrivals { padding: 10px; }

/* ── EMPTY / LOADING ── */
.center-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 14px;
  color: var(--muted);
  text-align: center;
  padding: 40px;
}
.center-state .icon { font-size: 2.5rem; opacity: .3; }
.center-state .label { font-size: .88rem; }
.center-state .sub { font-size: .72rem; color: #1e2d40; }
.spin-lg {
  width: 28px; height: 28px;
  border: 3px solid var(--border2);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

/* ── MISC ── */
.refresh-bar {
  height: 2px;
  background: var(--border);
  position: relative;
  flex-shrink: 0;
}
.refresh-progress {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: var(--blue);
  transition: width .5s linear;
  border-radius: 0 1px 1px 0;
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes blink { 0%,100% { opacity:1; } 50% { opacity:.2; } }
@keyframes fadeUp { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
@keyframes scanline {
  0% { top: -20px; }
  100% { top: 100%; }
}
</style>
</head>
<body>

<!-- TOPBAR -->
<div class="topbar">
  <div class="topbar-logo">🚄 <span>SNCF</span> OPS CENTER</div>
  <div class="topbar-clock" id="clock">--:--:--</div>
  <div class="topbar-status"><div class="status-dot"></div>SYSTEME NOMINAL</div>

  <div class="topbar-search">
    <input type="text" id="search" placeholder="Sélectionner une gare d'observation…" autocomplete="off">
    <span class="search-icon" id="search-icon">⌕</span>
    <div class="spin-sm" id="spin"></div>
    <div class="suggestions" id="sugg"></div>
  </div>

  <div class="topbar-tabs">
    <div class="tab active" data-view="train" onclick="switchMainTab(this)">Trajet</div>
    <div class="tab" data-view="board" onclick="switchMainTab(this)">Tableau</div>
    <div class="tab" data-view="arrivals" onclick="switchMainTab(this)">Arrivées</div>
    <div class="tab" data-view="disruptions" onclick="switchMainTab(this)">Alertes <span class="tab-count" id="alert-count" style="display:none">0</span></div>
  </div>
</div>

<div class="refresh-bar"><div class="refresh-progress" id="refresh-prog"></div></div>

<!-- WORKSPACE -->
<div class="workspace">

  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title" id="sidebar-title">Sélectionnez une gare</div>
      <div class="kpi-row" id="kpi-row" style="display:none">
        <div class="kpi ok"><div class="kpi-n" id="kpi-ok">0</div><div class="kpi-l">A l'heure</div></div>
        <div class="kpi warn"><div class="kpi-n" id="kpi-late">0</div><div class="kpi-l">Retard</div></div>
        <div class="kpi danger"><div class="kpi-n" id="kpi-cancel">0</div><div class="kpi-l">Supprimé</div></div>
        <div class="kpi info"><div class="kpi-n" id="kpi-total">0</div><div class="kpi-l">Total</div></div>
      </div>
    </div>
    <div class="trains-list" id="trains-list">
      <div class="center-state">
        <div class="icon">🔍</div>
        <div class="label">Aucune gare sélectionnée</div>
        <div class="sub">Utilisez la barre de recherche en haut</div>
      </div>
    </div>
  </div>

  <!-- DETAIL -->
  <div class="detail">
    <div class="view-tabs" id="view-tabs">
      <div class="view-tab visible active" data-view="train" onclick="switchDetailTab(this)">📍 Trajet détaillé</div>
      <div class="view-tab visible" data-view="board" onclick="switchDetailTab(this)">📋 Tableau des départs</div>
      <div class="view-tab visible" data-view="arrivals" onclick="switchDetailTab(this)">🚉 Arrivées</div>
      <div class="view-tab visible" data-view="disruptions" onclick="switchDetailTab(this)">⚠️ Perturbations réseau</div>
    </div>

    <!-- Vue: Trajet -->
    <div class="view active" id="view-train">
      <div class="center-state">
        <div class="icon">🚄</div>
        <div class="label">Sélectionnez un train</div>
        <div class="sub">Cliquez sur un départ dans la liste de gauche</div>
      </div>
    </div>

    <!-- Vue: Tableau départs -->
    <div class="view" id="view-board">
      <div class="center-state">
        <div class="icon">📋</div>
        <div class="label">Tableau des départs</div>
        <div class="sub">Sélectionnez une gare pour afficher le tableau</div>
      </div>
    </div>

    <!-- Vue: Arrivées -->
    <div class="view" id="view-arrivals">
      <div class="center-state">
        <div class="icon">🚉</div>
        <div class="label">Tableau des arrivées</div>
        <div class="sub">Sélectionnez une gare pour afficher les arrivées</div>
      </div>
    </div>

    <!-- Vue: Horaires -->
    <div class="view" id="view-schedules">
      <div class="center-state"><div class="icon">🕐</div><div class="label">Sélectionnez une gare</div></div>
    </div>

    <!-- Vue: Lignes -->
    <div class="view" id="view-lines">
      <div class="center-state"><div class="icon">🗺</div><div class="label">Sélectionnez une gare</div></div>
    </div>

    <!-- Vue: Itinéraire -->
    <div class="view" id="view-journey">
      <div style="padding:28px">
        <div class="board-title">🧭 CALCULATEUR D&#39;ITINÉRAIRE</div>
        <div style="display:flex;gap:10px;margin:0 0 16px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:160px">
            <div style="font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#3d5475;margin-bottom:4px">Départ (ID stop_area)</div>
            <input id="j-from" placeholder="stop_area:SNCF:87..." style="width:100%;background:#0b1422;border:1px solid #1a3354;border-radius:7px;padding:8px 12px;color:#ccd9ee;font-size:.85rem;outline:none">
          </div>
          <div style="flex:1;min-width:160px">
            <div style="font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#3d5475;margin-bottom:4px">Arrivée (ID stop_area)</div>
            <input id="j-to" placeholder="stop_area:SNCF:87..." style="width:100%;background:#0b1422;border:1px solid #1a3354;border-radius:7px;padding:8px 12px;color:#ccd9ee;font-size:.85rem;outline:none">
          </div>
          <button onclick="calcJourney()" style="background:#2f80ed;color:#fff;border:none;border-radius:7px;padding:9px 18px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit">Calculer →</button>
        </div>
        <div id="journey-result"></div>
      </div>
    </div>

    <!-- Vue: Perturbations -->
    <div class="view" id="view-disruptions">
      <div class="center-state">
        <div class="icon">📡</div>
        <div class="label">Chargement des perturbations réseau…</div>
      </div>
    </div>

  </div>
</div>

<script>
// ── Globals ──────────────────────────────────────────────────────
var currentStop  = null;
var allDepartures = [];
var refreshTimer  = null;
var refreshSecs   = 30;
var refreshLeft   = 30;
var selectedVjId  = null;

// ── Clock ──────────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  var h = pad2(now.getHours()), m = pad2(now.getMinutes()), s = pad2(now.getSeconds());
  document.getElementById("clock").textContent = h + ":" + m + ":" + s;
}
setInterval(updateClock, 1000);
updateClock();

// ── Refresh bar ────────────────────────────────────────────────
function startRefreshBar() {
  refreshLeft = refreshSecs;
  tickRefreshBar();
}
function tickRefreshBar() {
  var pct = ((refreshSecs - refreshLeft) / refreshSecs) * 100;
  document.getElementById("refresh-prog").style.width = pct + "%";
  if (refreshLeft > 0) {
    refreshLeft--;
    setTimeout(tickRefreshBar, 1000);
  } else {
    if (currentStop) loadDepartures(currentStop.id, currentStop.name, false);
    startRefreshBar();
  }
}

// ── Utils ──────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2,"0"); }
function esc(s) {
  return String(s||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function fmtT(s) {
  if (!s || s.length < 13) return "--:--";
  return s.slice(9,11)+":"+s.slice(11,13);
}
function fmtST(s) {
  if (!s || s.length < 4) return "--:--";
  return s.slice(0,2)+":"+s.slice(2,4);
}
function getDelay(dep) {
  var b = dep&&dep.stop_date_time&&dep.stop_date_time.base_departure_date_time;
  var a = dep&&dep.stop_date_time&&dep.stop_date_time.departure_date_time;
  if (!b||!a||b===a) return 0;
  return Math.round((parseInt(a.slice(9,11))*60+parseInt(a.slice(11,13))) - (parseInt(b.slice(9,11))*60+parseInt(b.slice(11,13))));
}
function getDelayFromST(b,a) {
  if (!b||!a||b===a) return 0;
  return (parseInt(a.slice(0,2))*60+parseInt(a.slice(2,4))) - (parseInt(b.slice(0,2))*60+parseInt(b.slice(2,4)));
}
function getLineColor(info) {
  if (info&&info.color) return "#"+info.color;
  var m = (info&&info.commercial_mode||"").toLowerCase();
  if (m.includes("tgv")) return "#c0092a";
  if (m.includes("ter")||m.includes("lio")) return "#e6007e";
  if (m.includes("intercit")) return "#0088ce";
  if (m.includes("transilien")||m.includes("rer")) return "#6f2c3f";
  return "#2f80ed";
}
function getMateriel(headsign, mode) {
  var n = parseInt(headsign);
  if (n>=4600&&n<=4800) return "Corail BB26000";
  if (n>=870000&&n<=879999) return "Regiolis AGC";
  if (n>=9500&&n<=9800) return "TGV Duplex";
  if (mode&&mode.toLowerCase().includes("ter")) return "ZGC / X73500";
  return null;
}

// ── Tabs ──────────────────────────────────────────────────────
function switchDetailTab(el) {
  document.querySelectorAll(".view-tab").forEach(function(t) { t.classList.remove("active"); });
  document.querySelectorAll(".view").forEach(function(v) { v.classList.remove("active"); });
  el.classList.add("active");
  document.getElementById("view-"+el.dataset.view).classList.add("active");

  if (el.dataset.view === "arrivals" && currentStop) loadArrivals(currentStop.id);
  if (el.dataset.view === "disruptions") loadDisruptions();
}
function switchMainTab(el) {
  // just switch detail tab as well
  var t = document.querySelector(".view-tab[data-view='" + el.dataset.view + "']");
  if (t) switchDetailTab(t);
  document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
  el.classList.add("active");
}

// ── Search ────────────────────────────────────────────────────
var searchTimer = null;
document.getElementById("search").addEventListener("input", function() {
  clearTimeout(searchTimer);
  var q = this.value.trim();
  if (q.length < 2) { hideSugg(); return; }
  document.getElementById("spin").classList.add("on");
  document.getElementById("search-icon").style.display = "none";
  searchTimer = setTimeout(function(){ doSearch(q); }, 400);
});
document.addEventListener("click", function(e) {
  if (!e.target.closest(".topbar-search")) hideSugg();
});
function hideSugg() {
  document.getElementById("sugg").classList.remove("on");
}
async function doSearch(q) {
  try {
    var res = await fetch("/api/places?q="+encodeURIComponent(q));
    var data = await res.json();
    var stops = (data.places||[]).filter(function(p){ return p.embedded_type==="stop_area"; });
    if (!stops.length) { hideSugg(); return; }
    var html = stops.map(function(p) {
      var stop = p.stop_area||p;
      var region = p.administrative_regions&&p.administrative_regions[0]&&p.administrative_regions[0].name||"";
      return '<div class="sug" data-id="'+esc(stop.id)+'" data-name="'+esc(p.name)+'">'
        +'<span class="sug-icon">📍</span>'
        +'<span class="sug-name">'+esc(p.name)+'</span>'
        +(region?'<span class="sug-region">'+esc(region)+'</span>':"")
        +'</div>';
    }).join("");
    document.getElementById("sugg").innerHTML = html;
    document.getElementById("sugg").classList.add("on");
    document.querySelectorAll(".sug").forEach(function(el) {
      el.addEventListener("click", function() {
        document.getElementById("search").value = this.dataset.name;
        hideSugg();
        loadDepartures(this.dataset.id, this.dataset.name, true);
      });
    });
  } catch(e) { hideSugg(); }
  finally {
    document.getElementById("spin").classList.remove("on");
    document.getElementById("search-icon").style.display = "";
  }
}

// ── Departures ────────────────────────────────────────────────
async function loadDepartures(stopId, name, showLoader) {
  currentStop = {id: stopId, name: name};
  if (showLoader) {
    document.getElementById("trains-list").innerHTML = '<div class="center-state"><div class="spin-lg"></div><div class="label">Chargement…</div></div>';
    document.getElementById("kpi-row").style.display = "none";
  }
  try {
    var res = await fetch("/api/departures?stop="+encodeURIComponent(stopId));
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    allDepartures = data.departures||[];
    renderDepartures(allDepartures, name);
    renderBoard(allDepartures, name);
    startRefreshBar();
  } catch(e) {
    document.getElementById("trains-list").innerHTML =
      '<div class="center-state"><div class="icon">⚠️</div><div class="label">'+esc(e.message)+'</div></div>';
  }
}

function renderDepartures(deps, name) {
  document.getElementById("sidebar-title").textContent = "📍 "+name;
  var nOk = 0, nLate = 0, nCancel = 0;
  deps.forEach(function(d) {
    var cancelled = (d.disruptions||[]).some(function(x){ return x.severity&&x.severity.effect==="NO_SERVICE"; });
    if (cancelled) nCancel++;
    else if (getDelay(d) > 0) nLate++;
    else nOk++;
  });
  document.getElementById("kpi-ok").textContent = nOk;
  document.getElementById("kpi-late").textContent = nLate;
  document.getElementById("kpi-cancel").textContent = nCancel;
  document.getElementById("kpi-total").textContent = deps.length;
  document.getElementById("kpi-row").style.display = "flex";

  if (!deps.length) {
    document.getElementById("trains-list").innerHTML = '<div class="center-state"><div class="icon">🚉</div><div class="label">Aucun départ</div></div>';
    return;
  }

  var html = deps.map(function(dep, i) {
    var info = dep.display_informations||{};
    var dt   = dep.stop_date_time||{};
    var delay = getDelay(dep);
    var isCancelled = (dep.disruptions||[]).some(function(x){ return x.severity&&x.severity.effect==="NO_SERVICE"; });
    var cause = dep.disruptions&&dep.disruptions[0]&&dep.disruptions[0].cause||"";
    var platform = dt.platform_code||null;
    var color = getLineColor(info);
    var mat = getMateriel(info.headsign, info.commercial_mode);
    var links = dep.links||[];
    var vjLink = links.find(function(l){ return l.type==="vehicle_journey"; });
    var vjId = vjLink?vjLink.id:"";

    var cls = "tcard"+(isCancelled?" cancelled":delay>=15?" very-late":delay>0?" late":"");
    var depColor = isCancelled?"var(--red)":delay>0?"var(--orange)":"var(--text)";

    var badges = "";
    if (!isCancelled&&delay===0) badges += '<span class="badge b-ok">✓ A l&#39;heure</span>';
    if (!isCancelled&&delay>0)   badges += '<span class="badge b-late">+'+delay+'&thinsp;min</span>';
    if (isCancelled)              badges += '<span class="badge b-cancel">Supprimé</span>';
    if (cause)                    badges += '<span class="b-cause">⚠ '+esc(cause)+'</span>';
    if (mat)                      badges += '<span class="b-mat">· '+esc(mat)+'</span>';

    return '<div class="'+cls+'" style="border-left-color:'+color+';animation-delay:'+(i*30)+'ms"'
      +' data-vjid="'+esc(vjId)+'" data-headsign="'+esc(info.headsign||"")+'"'
      +' data-mode="'+esc(info.commercial_mode||"")+'" data-dir="'+esc(info.direction||"")+'"'
      +' data-color="'+esc(color)+'">'
      +'<div class="tcard-row">'
        +'<div class="tcard-left">'
          +'<div style="margin-bottom:3px">'
            +'<span class="mode-chip" style="background:'+color+'20;color:'+color+';border:1px solid '+color+'30">'+esc(info.commercial_mode||"TRAIN")+'</span>'
            +'<span class="train-num">'+esc(info.headsign||"—")+'</span>'
          +'</div>'
          +'<div class="train-dir">→ '+esc((info.direction||"—").split("(")[0].trim())+'</div>'
          +'<div class="badge-row">'+badges+'</div>'
        +'</div>'
        +'<div class="tcard-right">'
          +'<div class="dep-time" style="color:'+depColor+'">'+(isCancelled?"SUPP":fmtT(dt.departure_date_time))+'</div>'
          +(delay>0&&!isCancelled?'<div class="dep-base">'+fmtT(dt.base_departure_date_time)+'</div>':"")
          +(platform?'<div class="voie-badge">Voie '+esc(platform)+'</div>':"")
        +'</div>'
      +'</div>'
      +'</div>';
  }).join("");

  document.getElementById("trains-list").innerHTML = html;
  document.querySelectorAll(".tcard").forEach(function(el) {
    el.addEventListener("click", function() {
      document.querySelectorAll(".tcard").forEach(function(c){ c.classList.remove("selected"); });
      this.classList.add("selected");
      // Switch to train tab
      document.querySelectorAll(".view-tab").forEach(function(t){ t.classList.remove("active"); });
      document.querySelectorAll(".view").forEach(function(v){ v.classList.remove("active"); });
      document.querySelector(".view-tab[data-view=train]").classList.add("active");
      document.getElementById("view-train").classList.add("active");
      showTrainDetail(this.dataset.vjid, this.dataset.headsign, this.dataset.mode, this.dataset.dir, this.dataset.color);
    });
  });
}

// ── Board ─────────────────────────────────────────────────────
function renderBoard(deps, name) {
  if (!deps.length) {
    document.getElementById("view-board").innerHTML = '<div class="center-state"><div class="icon">📋</div><div class="label">Aucun départ</div></div>';
    return;
  }
  var rows = deps.map(function(dep) {
    var info = dep.display_informations||{};
    var dt   = dep.stop_date_time||{};
    var delay = getDelay(dep);
    var isCancelled = (dep.disruptions||[]).some(function(x){ return x.severity&&x.severity.effect==="NO_SERVICE"; });
    var color = getLineColor(info);
    var depTime = isCancelled?"—":fmtT(dt.departure_date_time);
    var statusHtml = isCancelled
      ? '<span class="board-status-cancel">SUPPRIMÉ</span>'
      : delay>0
        ? '<span class="board-status-late">RETARD +'+delay+'min</span>'
        : '<span class="board-status-ok">A L&#39;HEURE</span>';

    return '<tr>'
      +'<td><span class="board-time" style="color:'+(isCancelled?"var(--red)":delay>0?"var(--orange)":"var(--text)")+'">'+depTime+'</span>'
      +(delay>0&&!isCancelled?'<div class="board-delay">'+fmtT(dt.base_departure_date_time)+'</div>':"")
      +'</td>'
      +'<td><span class="mode-chip" style="background:'+color+'20;color:'+color+';border:1px solid '+color+'30">'+esc(info.commercial_mode||"?")+'</span> <span style="font-family:JetBrains Mono,monospace;font-size:.8rem">'+esc(info.headsign||"")+'</span></td>'
      +'<td class="board-dest">'+esc((info.direction||"—").split("(")[0].trim())+'</td>'
      +'<td class="board-voie">'+(dt.platform_code||"—")+'</td>'
      +'<td>'+statusHtml+'</td>'
      +'</tr>';
  }).join("");

  document.getElementById("view-board").innerHTML =
    '<div style="padding:20px">'
    +'<div class="board-title">📋 TABLEAU DES DÉPARTS — '+esc(name)+'</div>'
    +'<table class="board-table">'
    +'<thead><tr><th>HEURE</th><th>TRAIN</th><th>DESTINATION</th><th>VOIE</th><th>ÉTAT</th></tr></thead>'
    +'<tbody>'+rows+'</tbody>'
    +'</table>'
    +'</div>';
}

// ── Arrivals ──────────────────────────────────────────────────
async function loadArrivals(stopId) {
  document.getElementById("view-arrivals").innerHTML = '<div class="center-state"><div class="spin-lg"></div><div class="label">Chargement des arrivées…</div></div>';
  try {
    var res = await fetch("/api/arrivals?stop="+encodeURIComponent(stopId));
    var data = await res.json();
    var arrivals = data.arrivals||[];
    if (!arrivals.length) {
      document.getElementById("view-arrivals").innerHTML = '<div class="center-state"><div class="icon">🚉</div><div class="label">Aucune arrivée trouvée</div></div>';
      return;
    }
    var rows = arrivals.map(function(arr) {
      var info = arr.display_informations||{};
      var dt   = arr.stop_date_time||{};
      var baseA = dt.base_arrival_date_time, realA = dt.arrival_date_time;
      var delay = 0;
      if (baseA&&realA&&baseA!==realA) {
        delay = (parseInt(realA.slice(9,11))*60+parseInt(realA.slice(11,13))) - (parseInt(baseA.slice(9,11))*60+parseInt(baseA.slice(11,13)));
      }
      var color = getLineColor(info);
      var isCancelled = (arr.disruptions||[]).some(function(x){ return x.severity&&x.severity.effect==="NO_SERVICE"; });
      return '<tr>'
        +'<td><span class="board-time" style="color:'+(isCancelled?"var(--red)":delay>0?"var(--orange)":"var(--text)")+'">'+fmtT(realA)+'</span>'
        +(delay>0?'<div class="board-delay">'+fmtT(baseA)+'</div>':"")
        +'</td>'
        +'<td><span class="mode-chip" style="background:'+color+'20;color:'+color+';border:1px solid '+color+'30">'+esc(info.commercial_mode||"?")+'</span> <span style="font-family:JetBrains Mono,monospace;font-size:.8rem">'+esc(info.headsign||"")+'</span></td>'
        +'<td class="board-dest" style="color:#6a8aaa">Depuis '+esc((info.direction||"—").split("(")[0].trim())+'</td>'
        +'<td class="board-voie">'+(dt.platform_code||"—")+'</td>'
        +'<td>'+(isCancelled?'<span class="board-status-cancel">SUPPRIMÉ</span>':delay>0?'<span class="board-status-late">RETARD +'+delay+'min</span>':'<span class="board-status-ok">A L&#39;HEURE</span>')+'</td>'
        +'</tr>';
    }).join("");
    document.getElementById("view-arrivals").innerHTML =
      '<div style="padding:20px">'
      +'<div class="board-title">🚉 TABLEAU DES ARRIVÉES — '+esc(currentStop&&currentStop.name||"")+'</div>'
      +'<table class="board-table">'
      +'<thead><tr><th>HEURE</th><th>TRAIN</th><th>PROVENANCE</th><th>VOIE</th><th>ÉTAT</th></tr></thead>'
      +'<tbody>'+rows+'</tbody>'
      +'</table>'
      +'</div>';
  } catch(e) {
    document.getElementById("view-arrivals").innerHTML = '<div class="center-state"><div class="icon">⚠️</div><div class="label">'+esc(e.message)+'</div></div>';
  }
}

// ── Disruptions ───────────────────────────────────────────────
async function loadDisruptions() {
  document.getElementById("view-disruptions").innerHTML = '<div class="center-state"><div class="spin-lg"></div><div class="label">Chargement des perturbations réseau…</div></div>';
  try {
    var res = await fetch("/api/disruptions");
    var data = await res.json();
    var disruptions = data.disruptions||[];
    var count = disruptions.length;
    var alertEl = document.getElementById("alert-count");
    if (count > 0) {
      alertEl.textContent = count;
      alertEl.style.display = "";
    } else {
      alertEl.style.display = "none";
    }

    if (!disruptions.length) {
      document.getElementById("view-disruptions").innerHTML = '<div class="center-state"><div class="icon">✅</div><div class="label">Aucune perturbation en cours</div><div class="sub">Le réseau est nominal</div></div>';
      return;
    }

    var html = '<div style="padding:20px"><div class="board-title">⚠️ PERTURBATIONS RÉSEAU ('+count+')</div>';
    html += disruptions.map(function(d, i) {
      var effect = d.severity&&d.severity.effect||"";
      var cause  = d.cause||"";
      var msg    = d.messages&&d.messages[0]&&(d.messages[0].text||d.messages[0].value)||"";
      var isSevere = effect==="NO_SERVICE"||effect==="SIGNIFICANT_DELAYS";
      var effectLabel = effect==="NO_SERVICE"?"TRAFIC INTERROMPU":effect==="SIGNIFICANT_DELAYS"?"RETARDS IMPORTANTS":effect==="REDUCED_SERVICE"?"SERVICE RÉDUIT":"INFORMATION";
      var effectCls   = effect==="NO_SERVICE"||effect==="SIGNIFICANT_DELAYS"?"effect-stop":"effect-delay";

      var appObj = d.impacted_objects&&d.impacted_objects[0];
      var network = appObj&&appObj.pt_object&&appObj.pt_object.name||"";

      return '<div class="disrup-card'+(isSevere?" severe":"")+ '" style="animation-delay:'+(i*40)+'ms">'
        +'<div class="disrup-title">'+esc(cause||(msg.slice(0,60))||"Perturbation réseau")+'</div>'
        +'<div class="disrup-meta">'
          +(network?'<span>📍 '+esc(network)+'</span>':"")
          +'<span>'+new Date(d.application_periods&&d.application_periods[0]&&d.application_periods[0].begin||"").toLocaleDateString("fr-FR")+'</span>'
        +'</div>'
        +(msg?'<div class="disrup-msg">'+esc(msg)+'</div>':"")
        +'<div><span class="disrup-effect '+effectCls+'">'+effectLabel+'</span></div>'
        +'</div>';
    }).join("");
    html += "</div>";
    document.getElementById("view-disruptions").innerHTML = html;
  } catch(e) {
    document.getElementById("view-disruptions").innerHTML = '<div class="center-state"><div class="icon">⚠️</div><div class="label">'+esc(e.message)+'</div></div>';
  }
}

// ── Train Detail ──────────────────────────────────────────────
async function showTrainDetail(vjId, headsign, mode, dir, color) {
  document.getElementById("view-train").innerHTML = '<div class="center-state"><div class="spin-lg"></div><div class="label">Chargement du trajet…</div></div>';
  if (!vjId) {
    document.getElementById("view-train").innerHTML = '<div class="center-state"><div class="icon">⚠️</div><div class="label">Identifiant de trajet introuvable</div></div>';
    return;
  }
  try {
    var res  = await fetch("/api/vehicle?id="+encodeURIComponent(vjId));
    var data = await res.json();
    var vj   = data.vehicle_journeys&&data.vehicle_journeys[0];
    if (!vj) throw new Error("Trajet introuvable");

    var disruption = data.disruptions&&data.disruptions[0];
    var impacted   = disruption&&disruption.impacted_objects&&disruption.impacted_objects[0]&&disruption.impacted_objects[0].impacted_stops||[];
    var disruptMsg = disruption&&disruption.messages&&disruption.messages[0]&&(disruption.messages[0].text||disruption.messages[0].value)||"";
    if (!disruptMsg&&disruption) disruptMsg = disruption.cause||"";

    var mat = getMateriel(headsign, mode);
    var stops = vj.stop_times||[];

    // Compute delays for chart
    var delayData = [];
    var prevDelay = 0;
    var delayStarted = false;
    var maxDelay = 0;

    stops.forEach(function(st, i) {
      var imp = impacted.find(function(imp){ return imp.stop_point&&imp.stop_point.id===st.stop_point.id; });
      var bT  = imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
      var aT  = imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
      var d   = getDelayFromST(bT, aT);
      delayData.push({name: st.stop_point&&st.stop_point.name||"?", delay: d});
      if (d > maxDelay) maxDelay = d;
    });

    // Hero
    var heroHTML = '<div class="train-hero" data-num="'+esc(headsign)+'">'
      +'<div class="hero-num" style="color:'+color+'">'+esc(headsign)+'</div>'
      +'<div class="hero-dir">→ '+esc((dir||"").split("(")[0].trim())+'</div>'
      +'<div class="hero-badges">'
        +'<span class="hero-badge" style="background:'+color+'18;color:'+color+';border-color:'+color+'35">'+esc(mode)+'</span>'
        +(mat?'<span class="hero-badge" style="background:#0f2040;color:#5ba3f5;border-color:#1a3566">'+esc(mat)+'</span>':"")
        +'<span class="hero-badge" style="background:#0f2040;color:#3d5475;border-color:#13253d">'+stops.length+' arrêts</span>'
      +'</div>'
      +'</div>';

    // Alert
    var alertHTML = '<div class="disruption-alert'+(disruptMsg?" on":"")+'"><strong>⚡ PERTURBATION</strong>'+esc(disruptMsg)+'</div>';

    // Delay chart
    var chartHTML = "";
    if (maxDelay > 0) {
      var bars = delayData.map(function(d) {
        var pct = maxDelay > 0 ? Math.round((d.delay/maxDelay)*100) : 0;
        var barColor = d.delay >= 15 ? "var(--red)" : d.delay > 0 ? "var(--orange)" : "var(--border2)";
        return '<div class="delay-bar-wrap">'
          +'<div class="delay-bar" style="height:'+pct+'%;background:'+barColor+'" title="'+esc(d.name)+' : '+d.delay+'min"></div>'
          +'<div class="delay-bar-label">'+esc(d.name.split(" ")[0])+'</div>'
          +'</div>';
      }).join("");
      chartHTML = '<div class="delay-chart-wrap on">'
        +'<div class="delay-chart-title">📊 Évolution du retard station par station</div>'
        +'<div class="delay-chart"><div class="delay-bars" style="padding-bottom:18px">'+bars+'</div></div>'
        +'</div>';
    }

    // Timeline
    prevDelay = 0; delayStarted = false;
    var tlHTML = '<div class="timeline">';
    stops.forEach(function(st, i) {
      var isFirst = i===0, isLast = i===stops.length-1;
      var imp = impacted.find(function(imp){ return imp.stop_point&&imp.stop_point.id===st.stop_point.id; });
      var bT  = imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
      var aT  = imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
      var delay = getDelayFromST(bT,aT);
      var platform = (st.stop_point&&st.stop_point.platform_code)||(imp&&imp.stop_point&&imp.stop_point.platform_code)||null;
      var isImpacted = delay>0;
      var isOrigin   = isImpacted&&!delayStarted;
      var isCatching = isImpacted&&delay<prevDelay&&prevDelay>0;
      if (isImpacted) delayStarted = true;

      var dotCls = "tl-dot"+(isFirst?" first":isLast?" last":isOrigin?" origin":isImpacted?" impacted":"");
      var segCls = "tl-seg"+(isImpacted?" impacted":"");

      tlHTML += '<div class="tl-stop" style="animation-delay:'+(i*15)+'ms">'
        +'<div class="tl-col">'
          +'<div class="'+dotCls+'"></div>'
          +(!isLast?'<div class="'+segCls+'"></div>':"")
        +'</div>'
        +'<div class="tl-content">'
          +(isOrigin?'<div class="tl-incident">⚡ Gare d&#39;incident</div>':"")
          +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">'
            +'<span class="tl-name">'+esc(st.stop_point&&st.stop_point.name||"—")+'</span>'
            +(platform?'<span class="tl-voie">Voie '+esc(platform)+'</span>':"")
          +'</div>'
          +'<div class="tl-times">'
            +'<span class="tl-time">'+fmtST(aT)+'</span>'
            +(delay>0?'<span class="tl-base">'+fmtST(bT)+'</span>':"")
            +(delay>0?'<span class="tl-delay">+'+delay+'&thinsp;min</span>':"")
            +(isCatching?'<span class="tl-catch">-'+(prevDelay-delay)+'min rattrapé</span>':"")
          +'</div>'
        +'</div>'
        +'</div>';
      prevDelay = delay;
    });
    tlHTML += "</div>";

    document.getElementById("view-train").innerHTML = heroHTML + alertHTML + chartHTML + tlHTML;
  } catch(e) {
    document.getElementById("view-train").innerHTML = '<div class="center-state"><div class="icon">⚠️</div><div class="label">'+esc(e.message)+'</div></div>';
  }
}


// ── Horaires ──────────────────────────────────────────────────
async function loadSchedules(stopId) {
  document.getElementById("view-schedules").innerHTML = '<div class="center-state"><div class="spin-lg"></div><div class="label">Chargement horaires...</div></div>';
  try {
    var res = await fetch("/api/schedules?stop=" + encodeURIComponent(stopId));
    var data = await res.json();
    var sc = data.stop_schedules || [];
    if (!sc.length) { document.getElementById("view-schedules").innerHTML = '<div class="center-state"><div class="icon">🕐</div><div class="label">Aucun horaire</div></div>'; return; }
    var html = '<div style="padding:20px"><div class="board-title">🕐 HORAIRES — ' + esc(currentStop&&currentStop.name||"") + '</div>';
    sc.forEach(function(s, i) {
      var route = s.route||{}, line = route.line||{};
      var col = line.color ? "#"+line.color : "#2f80ed";
      var times = (s.date_times||[]).map(function(dt) {
        var rt = dt.data_freshness === "realtime";
        return '<span style="background:#0b1422;border:1px solid ' + (rt?"rgba(0,230,118,.3)":"#1a3354") + ';border-radius:6px;padding:3px 9px;font-family:JetBrains Mono,monospace;font-size:.78rem;color:' + (rt?"#00e676":"#ccd9ee") + '">'
          + formatTime2(dt.date_time||dt.base_date_time) + '</span>';
      }).join("");
      html += '<div style="background:#0b1422;border:1px solid #13253d;border-radius:8px;padding:12px 14px;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '35;font-family:JetBrains Mono,monospace;font-size:.58rem;font-weight:700;padding:1px 5px;border-radius:3px">' + esc(line.commercial_mode&&line.commercial_mode.name||"LIGNE") + '</span>'
        + '<span style="font-weight:700;font-size:.85rem">' + esc(line.code||line.name||"") + '</span>'
        + '<span style="color:#3d5475;font-size:.72rem;flex:1">→ ' + esc(route.direction&&route.direction.stop_area&&route.direction.stop_area.name||"") + '</span></div>'
        + (times ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' + times + '</div>' : '<div style="color:#3d5475;font-size:.72rem">Pas de départ imminent</div>')
        + '</div>';
    });
    document.getElementById("view-schedules").innerHTML = html + '</div>';
  } catch(e) {
    document.getElementById("view-schedules").innerHTML = '<div class="center-state"><div class="icon">⚠️</div><div class="label">' + esc(e.message) + '</div></div>';
  }
}

function formatTime2(s) {
  if (!s || s.length < 13) return "--:--";
  return s.slice(9,11) + ":" + s.slice(11,13);
}

// ── Lignes ─────────────────────────────────────────────────────
async function loadLines(stopId) {
  document.getElementById("view-lines").innerHTML = '<div class="center-state"><div class="spin-lg"></div><div class="label">Chargement lignes...</div></div>';
  try {
    var res = await fetch("/api/lines?stop=" + encodeURIComponent(stopId));
    var data = await res.json();
    var lines = data.lines || [];
    if (!lines.length) { document.getElementById("view-lines").innerHTML = '<div class="center-state"><div class="icon">🗺</div><div class="label">Aucune ligne</div></div>'; return; }
    var html = '<div style="padding:20px"><div class="board-title">🗺 LIGNES — ' + esc(currentStop&&currentStop.name||"") + '</div>';
    lines.forEach(function(l, i) {
      var col = l.color ? "#"+l.color : "#2f80ed";
      var routes = (l.routes||[]).slice(0,3).map(function(ro) {
        return ro.direction&&ro.direction.stop_area&&ro.direction.stop_area.name||ro.name||"";
      }).filter(Boolean).join(" · ");
      html += '<div style="background:#0b1422;border:1px solid #13253d;border-radius:8px;padding:11px 13px;margin-bottom:6px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        + '<span style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '35;font-family:JetBrains Mono,monospace;font-size:.58rem;font-weight:700;padding:1px 5px;border-radius:3px">' + esc(l.commercial_mode&&l.commercial_mode.name||"LIGNE") + '</span>'
        + '<span style="font-weight:700;font-size:.9rem">' + esc(l.code||l.name||"") + '</span>'
        + '<span style="color:#3d5475;font-size:.72rem;margin-left:4px">' + esc(l.name||"") + '</span>'
        + (l.opening_time&&l.closing_time ? '<span style="margin-left:auto;font-family:JetBrains Mono,monospace;font-size:.62rem;color:#3d5475">' + l.opening_time.slice(0,2)+":"+l.opening_time.slice(2,4) + " – " + l.closing_time.slice(0,2)+":"+l.closing_time.slice(2,4) + '</span>' : "")
        + '</div>'
        + (routes ? '<div style="font-size:.7rem;color:#3d5475">↔ ' + esc(routes) + '</div>' : "")
        + '</div>';
    });
    document.getElementById("view-lines").innerHTML = html + '</div>';
  } catch(e) {
    document.getElementById("view-lines").innerHTML = '<div class="center-state"><div class="icon">⚠️</div><div class="label">' + esc(e.message) + '</div></div>';
  }
}

// ── Itinéraire ─────────────────────────────────────────────────
async function calcJourney() {
  var from = document.getElementById("j-from").value.trim();
  var to   = document.getElementById("j-to").value.trim();
  if (!from||!to) { document.getElementById("journey-result").innerHTML = '<div style="color:#ff9100;font-size:.82rem;padding:10px">Renseignez les deux champs.</div>'; return; }
  document.getElementById("journey-result").innerHTML = '<div class="center-state"><div class="spin-lg"></div></div>';
  try {
    var res = await fetch("/api/journeys?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to));
    var data = await res.json();
    var journeys = data.journeys||[];
    if (!journeys.length) { document.getElementById("journey-result").innerHTML = '<div style="color:#3d5475;padding:16px;font-size:.82rem">Aucun itinéraire. Utilisez des IDs stop_area (ex: stop_area:SNCF:87391003).</div>'; return; }
    document.getElementById("journey-result").innerHTML = journeys.map(function(j, i) {
      var dep = j.departure_date_time, arr = j.arrival_date_time;
      var dH = dep?dep.slice(9,11)+":"+dep.slice(11,13):"?";
      var aH = arr?arr.slice(9,11)+":"+arr.slice(11,13):"?";
      var dur = j.duration ? (Math.floor(j.duration/3600)>0?Math.floor(j.duration/3600)+"h ":"") + Math.floor((j.duration%3600)/60)+"min" : "";
      var secs = (j.sections||[]).map(function(s) {
        if (s.type==="public_transport") {
          var info = s.display_informations||{};
          var col = info.color?"#"+info.color:"#2f80ed";
          var from2 = s.from&&(s.from.stop_point&&s.from.stop_point.name||s.from.name)||"";
          var to2   = s.to&&(s.to.stop_point&&s.to.stop_point.name||s.to.name)||"";
          var dT = s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"";
          return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.78rem">'
            + '<span style="font-family:JetBrains Mono,monospace;color:#56a0f5;min-width:40px">'+dT+'</span>'
            + '<span>🚄</span>'
            + '<span><strong style="color:'+col+'">'+esc(info.commercial_mode||"")+" "+esc(info.headsign||"")+'</strong> '+esc(from2)+' → <strong>'+esc(to2)+'</strong></span>'
            + '</div>';
        }
        if (s.type==="waiting") return '<div style="font-size:.72rem;color:#3d5475;margin-bottom:5px;padding-left:48px">⏳ Correspondance '+Math.round((s.duration||0)/60)+'min</div>';
        if (s.type==="street_network"||s.type==="crow_fly") return '<div style="font-size:.72rem;color:#3d5475;margin-bottom:5px;padding-left:48px">🚶 À pied '+Math.round((s.duration||0)/60)+'min</div>';
        return "";
      }).join("");
      return '<div style="background:#0b1422;border:1px solid #13253d;border-radius:8px;padding:14px;margin-bottom:10px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
        + '<span style="font-family:JetBrains Mono,monospace;font-weight:700;font-size:1rem">'+dH+' → '+aH+'</span>'
        + '<span style="color:#00c2d4;font-weight:700;font-size:.8rem;background:rgba(0,194,212,.08);padding:2px 8px;border-radius:20px;border:1px solid rgba(0,194,212,.2)">'+dur+'</span>'
        + '</div>' + secs + '</div>';
    }).join("");
  } catch(e) {
    document.getElementById("journey-result").innerHTML = '<div style="color:#ff1744;padding:12px;font-size:.82rem">⚠️ ' + esc(e.message) + '</div>';
  }
}

// Load disruptions on start
loadDisruptions();
</script>
</body>
</html>`;