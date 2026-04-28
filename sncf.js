#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNCF OPS CENTER — Serveur avec cache intelligent
// Usage : node sncf.js TA_CLE_API
// Puis  : http://localhost:3333
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT     = process.env.PORT || 3333;
const BASE_URL = "api.sncf.com";
const BASE_PATH = "/v1/coverage/sncf/";

if (!API_KEY) {
  console.error("\n❌  Clé API manquante !");
  console.error("👉 Ajoute SNCF_API_KEY dans Render (Environment Variables)");
  console.error("👉 Ou lance : node sncf.js TA_CLE_API\n");
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CACHE — économise les requêtes API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const cache = new Map();
const CACHE_TTL = {
  places:       5 * 60 * 1000,  // 5 min
  departures:   20 * 1000,       // 20 sec (temps réel)
  arrivals:     20 * 1000,       // 20 sec
  vehicle:      30 * 1000,       // 30 sec
  disruptions:  60 * 1000,       // 1 min
  traffic:      60 * 1000,       // 1 min
  schedules:    20 * 1000,       // 20 sec
  lines:        10 * 60 * 1000,  // 10 min
  journeys:     2 * 60 * 1000,   // 2 min
};

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, ts: Date.now(), ttl });
}
// Nettoyage cache toutes les 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.ts > v.ttl) cache.delete(k);
  }
}, 5 * 60 * 1000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATS requêtes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const stats = { total: 0, cached: 0, api: 0, errors: 0, startTime: Date.now() };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APPEL API SNCF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const pad = n => String(n).padStart(2, "0");
const ts  = () => new Date().toLocaleTimeString("fr-FR");
const log = (e, m) => console.log("[" + ts() + "] " + e + "  " + m);

function sncfGet(path, ttlKey) {
  const cacheKey = path;
  const cached = cacheGet(cacheKey);
  if (cached) {
    stats.cached++;
    return Promise.resolve(cached);
  }

  stats.api++;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE_URL,
      path: BASE_PATH + path,
      headers: {
        Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64"),
        Accept: "application/json",
      },
    };
    https.get(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          const data = JSON.parse(raw);
          cacheSet(cacheKey, data, CACHE_TTL[ttlKey] || 30000);
          resolve(data);
        } catch(e) { reject(new Error("JSON invalide")); }
      });
    }).on("error", e => { stats.errors++; reject(e); });
  });
}

function nowNavitia() {
  const n = new Date();
  return n.getFullYear() + pad(n.getMonth()+1) + pad(n.getDate()) + "T" + pad(n.getHours()) + pad(n.getMinutes()) + "00";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVEUR HTTP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path   = parsed.pathname;
  const q      = parsed.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  stats.total++;

  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML);
    return;
  }

  res.setHeader("Content-Type", "application/json");

  // Stats système
  if (path === "/api/stats") {
    res.end(JSON.stringify({
      ...stats,
      cacheSize: cache.size,
      uptime: Math.round((Date.now() - stats.startTime) / 1000),
      savedRequests: stats.cached
    }));
    return;
  }

  try {
    let data;

if (path === "/api/places") {
  const query = (q.q || "").trim();

  if (!query) {
    res.end(JSON.stringify({ places: [] }));
    return;
  }

  log("🔍", "Recherche: " + query);

  data = await sncfGet(
    "places?q=" + encodeURIComponent(query) + "&type[]=stop_area&count=8",
    "places"
  );

  log("✅", (data.places || []).length + " gare(s)");
}

  if (!query) {
    res.end(JSON.stringify({ places: [] }));
    return;
  }

  log("🔍", "Recherche: " + query);

  data = await sncfGet(
    "places?q=" + encodeURIComponent(query) + "&type[]=stop_area&count=8",
    "places"
  );

  log("✅", (data.places || []).length + " gare(s)");
}

    else if (path === "/api/arrivals") {
      const dt = nowNavitia();
      log("🚉", "Arrivees: " + (q.stop||"").slice(-20));
      data = await sncfGet(
        "stop_areas/" + encodeURIComponent(q.stop) +
        "/arrivals?from_datetime=" + dt + "&count=40&data_freshness=realtime&depth=2",
        "arrivals"
      );
      log("✅", (data.arrivals||[]).length + " arrivee(s)");
    }

    else if (path === "/api/vehicle") {
      log("🛑", "Trajet: " + (q.id||"").slice(-20));
      data = await sncfGet(
        "vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=realtime",
        "vehicle"
      );
      log("✅", (data.vehicle_journeys&&data.vehicle_journeys[0]&&data.vehicle_journeys[0].stop_times&&data.vehicle_journeys[0].stop_times.length||0) + " arret(s)");
    }

    else if (path === "/api/disruptions") {
      log("⚠️ ", "Perturbations reseau");
      data = await sncfGet("disruptions?count=100&depth=2", "disruptions");
      log("✅", (data.disruptions||[]).length + " perturbation(s)");
    }

    else if (path === "/api/traffic") {
      log("📡", "Traffic report");
      data = await sncfGet("traffic_reports?depth=2&count=100", "traffic");
      log("✅", "Traffic OK");
    }

    else if (path === "/api/schedules") {
      log("📅", "Stop schedules: " + (q.stop||"").slice(-20));
      const dt = nowNavitia();
      data = await sncfGet(
        "stop_areas/" + encodeURIComponent(q.stop) +
        "/stop_schedules?from_datetime=" + dt + "&data_freshness=realtime&items_per_schedule=3&depth=2",
        "schedules"
      );
      log("✅", (data.stop_schedules||[]).length + " lignes");
    }

    else if (path === "/api/lines") {
      log("🗺️ ", "Lignes gare: " + (q.stop||"").slice(-20));
      data = await sncfGet(
        "stop_areas/" + encodeURIComponent(q.stop) + "/lines?depth=2",
        "lines"
      );
      log("✅", (data.lines||[]).length + " ligne(s)");
    }

    else if (path === "/api/journeys") {
      log("🧭", "Itineraire: " + q.from + " → " + q.to);
      const dt = nowNavitia();
      data = await sncfGet(
        "journeys?from=" + encodeURIComponent(q.from) +
        "&to=" + encodeURIComponent(q.to) +
        "&datetime=" + dt + "&count=3&data_freshness=realtime",
        "journeys"
      );
      log("✅", (data.journeys||[]).length + " trajet(s)");
    }

    else if (path === "/api/linereport") {
      log("📊", "Line report: " + q.line);
      data = await sncfGet(
        "lines/" + encodeURIComponent(q.line) +
        "/line_reports?depth=2&data_freshness=realtime",
        "disruptions"
      );
      log("✅", "Line report OK");
    }

    else {
      res.writeHead(404);
      res.end(JSON.stringify({error: "Not found"}));
      return;
    }

    res.end(JSON.stringify(data));
  } catch(e) {
    stats.errors++;
    log("❌", e.message);
    res.end(JSON.stringify({error: e.message}));
  }
});

server.listen(PORT, async () => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚄  SNCF OPS CENTER");
  console.log("🌐  http://localhost:" + PORT);
  console.log("💾  Cache actif — économise vos 5000 requêtes/mois");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⏳  Test connexion SNCF...");
  try {
    const d = await sncfGet("places?q=paris&type[]=stop_area&count=1", "places");
    if (d.places) console.log("✅  API SNCF OK ! Ouvre http://localhost:" + PORT + "\n");
    else console.log("⚠️  Réponse inattendue:", JSON.stringify(d).slice(0, 80));
  } catch(e) { console.log("❌  Erreur:", e.message + "\n"); }
  console.log("📋  Requêtes en temps réel ici.\n");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERFACE HTML
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNCF OPS CENTER</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#04070e;--panel:#070d18;--card:#0b1422;--card2:#0e1928;
  --border:#13253d;--border2:#1a3354;
  --text:#ccd9ee;--muted:#3d5475;
  --blue:#2f80ed;--blue2:#56a0f5;--cyan:#00c2d4;
  --green:#00e676;--green2:#1de9b6;
  --orange:#ff9100;--red:#ff1744;--yellow:#ffd600;--purple:#7c4dff;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:"DM Sans",sans-serif;display:flex;flex-direction:column}

/* ── TOPBAR ── */
.topbar{height:52px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:16px;flex-shrink:0;z-index:20}
.brand{font-family:"Bebas Neue",sans-serif;font-size:1.2rem;letter-spacing:.1em;color:var(--blue2);display:flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0}
.brand span{color:var(--text)}
.clock{font-family:"JetBrains Mono",monospace;font-size:.85rem;color:var(--cyan);letter-spacing:.05em;white-space:nowrap;flex-shrink:0}
.sys-status{display:flex;align-items:center;gap:5px;font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;flex-shrink:0}
.status-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:blink 2s ease infinite}

.search-wrap{flex:1;max-width:340px;position:relative}
.search-wrap input{width:100%;background:var(--card);border:1px solid var(--border2);border-radius:8px;padding:8px 32px 8px 12px;color:var(--text);font-size:.82rem;font-family:"DM Sans",sans-serif;outline:none;transition:border-color .2s,box-shadow .2s}
.search-wrap input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(47,128,237,.12)}
.search-wrap input::placeholder{color:var(--muted)}
.search-icon{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:.85rem;pointer-events:none}
.spin-sm{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:13px;height:13px;border:2px solid var(--border2);border-top-color:var(--blue);border-radius:50%;animation:spin .7s linear infinite;display:none}
.spin-sm.on{display:block}

.sugg{position:absolute;top:calc(100% + 5px);left:0;right:0;z-index:200;background:#0a1525;border:1px solid var(--border2);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.9);overflow:hidden;display:none}
.sugg.on{display:block}
.sug{padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--border);font-size:.82rem;transition:background .1s;display:flex;align-items:center;gap:8px}
.sug:last-child{border-bottom:none}
.sug:hover{background:#112038}
.sug-name{color:var(--text);flex:1}
.sug-region{color:var(--muted);font-size:.68rem}

/* Stats mini */
.api-stats{display:flex;align-items:center;gap:12px;margin-left:auto;font-size:.62rem;font-family:"JetBrains Mono",monospace;color:var(--muted);flex-shrink:0}
.api-stat{display:flex;align-items:center;gap:4px}
.api-stat-n{color:var(--blue2);font-weight:700}
.api-stat.warn .api-stat-n{color:var(--orange)}
.api-stat.danger .api-stat-n{color:var(--red)}

/* Tabs topbar */
.top-tabs{display:flex;gap:2px;flex-shrink:0}
.ttab{padding:5px 12px;border-radius:6px;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;color:var(--muted);transition:all .15s;border:1px solid transparent;white-space:nowrap}
.ttab:hover{color:var(--text);background:var(--card)}
.ttab.active{color:var(--blue2);background:rgba(47,128,237,.1);border-color:rgba(47,128,237,.25)}
.ttab .cnt{display:inline-block;background:var(--red);color:#fff;border-radius:10px;padding:1px 5px;font-size:.58rem;margin-left:4px;vertical-align:middle}

/* ── WORKSPACE ── */
.workspace{flex:1;display:flex;overflow:hidden}

/* ── SIDEBAR ── */
.sidebar{width:360px;min-width:360px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sidebar-head{padding:10px 12px 8px;border-bottom:1px solid var(--border);flex-shrink:0}
.sidebar-gare{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.kpis{display:flex;gap:5px}
.kpi{flex:1;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:6px 8px;text-align:center}
.kpi-n{font-family:"JetBrains Mono",monospace;font-size:1.2rem;font-weight:700;line-height:1}
.kpi-l{font-size:.52rem;color:var(--muted);margin-top:1px;text-transform:uppercase;letter-spacing:.06em}
.kpi.ok .kpi-n{color:var(--green)}
.kpi.warn .kpi-n{color:var(--orange)}
.kpi.danger .kpi-n{color:var(--red)}
.kpi.info .kpi-n{color:var(--blue2)}

.tlist{flex:1;overflow-y:auto;padding:8px}
.tlist::-webkit-scrollbar{width:3px}
.tlist::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}

/* Train card sidebar */
.tcard{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:7px;padding:10px 11px;margin-bottom:5px;cursor:pointer;transition:background .12s,transform .1s;animation:fadeUp .2s ease both;position:relative}
.tcard:hover{background:var(--card2);transform:translateX(2px)}
.tcard.sel{background:#0f1e35;border-color:var(--blue);box-shadow:0 0 0 1px rgba(47,128,237,.25)}
.tcard.late{border-left-color:var(--orange)}
.tcard.verylate{border-left-color:var(--red)}
.tcard.cancelled{border-left-color:var(--red);opacity:.55}
.tc-row{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}
.tc-left{flex:1;min-width:0}
.tc-right{text-align:right;flex-shrink:0}
.mode-chip{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:.56rem;font-weight:700;padding:1px 5px;border-radius:3px;letter-spacing:.1em;margin-right:4px;vertical-align:middle}
.tnum{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:.88rem;vertical-align:middle}
.tdir{font-size:.75rem;color:#5a7a9a;margin:2px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brow{display:flex;gap:3px;flex-wrap:wrap;align-items:center}
.b{font-size:.58rem;font-weight:700;padding:1px 5px;border-radius:20px;white-space:nowrap}
.b-ok{background:rgba(0,230,118,.07);color:var(--green);border:1px solid rgba(0,230,118,.18)}
.b-late{background:rgba(255,145,0,.07);color:var(--orange);border:1px solid rgba(255,145,0,.18)}
.b-cancel{background:rgba(255,23,68,.07);color:var(--red);border:1px solid rgba(255,23,68,.18)}
.b-cause{color:var(--muted);font-size:.56rem}
.dtime{font-family:"JetBrains Mono",monospace;font-size:1.45rem;font-weight:700;line-height:1;letter-spacing:-.02em}
.dbase{font-family:"JetBrains Mono",monospace;font-size:.65rem;color:var(--muted);text-decoration:line-through}
.voie{display:inline-block;margin-top:3px;background:#0f2040;color:#5ba3f5;border:1px solid #1a3566;padding:2px 6px;border-radius:4px;font-size:.65rem;font-family:"JetBrains Mono",monospace;font-weight:700}

/* ── DETAIL ── */
.detail{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
.vtabs{display:flex;border-bottom:1px solid var(--border);background:var(--panel);padding:0 16px;flex-shrink:0;overflow-x:auto}
.vtabs::-webkit-scrollbar{height:2px}
.vtabs::-webkit-scrollbar-thumb{background:var(--border2)}
.vtab{padding:11px 14px;font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;flex-shrink:0}
.vtab:hover{color:var(--text)}
.vtab.active{color:var(--blue2);border-bottom-color:var(--blue2)}

.view{display:none;flex:1;overflow-y:auto}
.view.active{display:block}
.view::-webkit-scrollbar{width:4px}
.view::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}

/* ── VIEW: TRAJET ── */
.train-hero{padding:24px 28px 18px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,#07111f 0%,var(--bg) 100%);position:relative;overflow:hidden;flex-shrink:0}
.train-hero::before{content:attr(data-num);position:absolute;right:-10px;top:-20px;font-family:"Bebas Neue",sans-serif;font-size:8rem;color:rgba(255,255,255,.022);pointer-events:none;user-select:none;line-height:1}
.hero-num{font-family:"Bebas Neue",sans-serif;font-size:3.5rem;line-height:1;letter-spacing:.02em;margin-bottom:3px}
.hero-dir{font-size:.9rem;color:#6a8aaa;margin-bottom:12px}
.hero-badges{display:flex;gap:6px;flex-wrap:wrap}
.hbadge{padding:3px 10px;border-radius:5px;font-size:.68rem;font-weight:700;border:1px solid}

.alert-box{margin:14px 28px;background:rgba(255,23,68,.06);border:1px solid rgba(255,23,68,.22);border-left:3px solid var(--red);border-radius:8px;padding:11px 14px;font-size:.8rem;color:#ff8a9a;display:none}
.alert-box.on{display:block}
.alert-box strong{color:var(--red);display:block;margin-bottom:3px;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase}

/* Delay chart */
.chart-wrap{margin:12px 28px;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:14px;display:none}
.chart-wrap.on{display:block}
.chart-title{font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px}
.chart-bars{display:flex;align-items:flex-end;gap:2px;height:50px;padding-bottom:14px}
.cbar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;position:relative}
.cbar{width:100%;border-radius:2px 2px 0 0;min-height:2px;cursor:default}
.cbar-lbl{position:absolute;bottom:-13px;font-size:.42rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28px;text-align:center}

/* Timeline */
.timeline{padding:18px 28px 36px}
.tl-stop{display:flex;gap:12px;animation:fadeUp .18s ease both}
.tl-col{display:flex;flex-direction:column;align-items:center;width:12px;flex-shrink:0;padding-top:5px}
.tl-dot{width:8px;height:8px;border-radius:50%;border:2px solid var(--border2);background:var(--bg);flex-shrink:0}
.tl-dot.first{background:var(--green2);border-color:var(--green2);box-shadow:0 0 7px rgba(29,233,182,.45)}
.tl-dot.last{background:var(--red);border-color:var(--red);box-shadow:0 0 7px rgba(255,23,68,.45)}
.tl-dot.impacted{border-color:var(--orange);box-shadow:0 0 5px rgba(255,145,0,.4)}
.tl-dot.origin{background:var(--red);border-color:var(--red);box-shadow:0 0 10px rgba(255,23,68,.55)}
.tl-seg{width:1px;flex:1;min-height:16px;background:var(--border);margin:2px 0}
.tl-seg.imp{background:rgba(255,145,0,.28)}
.tl-content{flex:1;padding-bottom:15px;border-bottom:1px solid var(--border)}
.tl-stop:last-child .tl-content{border-bottom:none}
.tl-name{font-size:.84rem;font-weight:600;color:var(--text);margin-bottom:2px}
.tl-incident{font-size:.56rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--red);margin-bottom:3px}
.tl-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.tl-times{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tl-time{font-family:"JetBrains Mono",monospace;font-size:.85rem;font-weight:500;color:var(--blue2)}
.tl-base{font-family:"JetBrains Mono",monospace;font-size:.68rem;color:var(--muted);text-decoration:line-through}
.tl-delay{font-size:.65rem;font-weight:700;color:var(--orange)}
.tl-catch{font-size:.6rem;font-weight:700;color:var(--green2);background:rgba(29,233,182,.07);padding:1px 5px;border-radius:10px}
.tl-voie{font-family:"JetBrains Mono",monospace;font-size:.62rem;background:#0f2040;color:#5ba3f5;border:1px solid #1a3566;padding:1px 6px;border-radius:4px}

/* ── VIEW: TABLEAU ── */
.board-wrap{padding:18px}
.board-title{font-family:"Bebas Neue",sans-serif;font-size:1.1rem;letter-spacing:.15em;color:var(--cyan);margin-bottom:12px}
.btable{width:100%;border-collapse:collapse}
.btable th{font-size:.56rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:5px 9px;text-align:left;border-bottom:1px solid var(--border)}
.btable td{padding:9px 9px;border-bottom:1px solid #0b1525;font-size:.8rem;vertical-align:middle}
.btable tr:hover td{background:#060d1a;cursor:pointer}
.bt-time{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:1rem}
.bt-delay{font-family:"JetBrains Mono",monospace;font-size:.72rem;color:var(--orange)}
.bt-dest{font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-voie{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:.95rem;color:#5ba3f5}
.st-ok{color:var(--green);font-size:.65rem;font-weight:700}
.st-late{color:var(--orange);font-size:.65rem;font-weight:700}
.st-cancel{color:var(--red);font-size:.65rem;font-weight:700}

/* ── VIEW: SCHEDULES ── */
.sched-wrap{padding:18px}
.sched-line{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;animation:fadeUp .2s ease both}
.sched-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sched-route{font-size:.75rem;color:var(--muted);margin-bottom:6px}
.sched-times{display:flex;gap:6px;flex-wrap:wrap}
.sched-time-chip{background:var(--card2);border:1px solid var(--border2);border-radius:6px;padding:4px 9px;font-family:"JetBrains Mono",monospace;font-size:.78rem;color:var(--text)}
.sched-time-chip.realtime{border-color:rgba(0,230,118,.3);color:var(--green)}
.sched-time-chip.late{border-color:rgba(255,145,0,.3);color:var(--orange)}

/* ── VIEW: DISRUPTIONS ── */
.disrup-wrap{padding:18px}
.disrup-card{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--orange);border-radius:8px;padding:12px 14px;margin-bottom:8px;animation:fadeUp .2s ease both}
.disrup-card.sev{border-left-color:var(--red)}
.disrup-card.low{border-left-color:var(--blue)}
.disrup-title{font-weight:700;font-size:.84rem;margin-bottom:3px;color:var(--text)}
.disrup-meta{font-size:.66rem;color:var(--muted);margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap}
.disrup-msg{font-size:.74rem;color:#8899aa;line-height:1.5}
.eff-chip{display:inline-block;font-size:.58rem;font-weight:700;padding:2px 7px;border-radius:20px;margin-top:5px}
.eff-stop{background:rgba(255,23,68,.08);color:var(--red);border:1px solid rgba(255,23,68,.2)}
.eff-delay{background:rgba(255,145,0,.08);color:var(--orange);border:1px solid rgba(255,145,0,.2)}
.eff-ok{background:rgba(0,230,118,.08);color:var(--green);border:1px solid rgba(0,230,118,.2)}

/* ── VIEW: ITINERAIRE ── */
.journey-wrap{padding:18px}
.journey-search{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end}
.journey-field{flex:1;min-width:140px}
.journey-field label{font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px}
.journey-field input{width:100%;background:var(--card);border:1px solid var(--border2);border-radius:7px;padding:8px 11px;color:var(--text);font-size:.82rem;font-family:"DM Sans",sans-serif;outline:none;transition:border-color .2s}
.journey-field input:focus{border-color:var(--blue)}
.journey-field input::placeholder{color:var(--muted)}
.journey-btn{background:var(--blue);color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:"DM Sans",sans-serif;transition:background .15s;white-space:nowrap}
.journey-btn:hover{background:var(--blue2)}
.jcard{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px;animation:fadeUp .2s ease both}
.jcard-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.jcard-time{font-family:"JetBrains Mono",monospace;font-size:1rem;font-weight:700;color:var(--text)}
.jcard-dur{font-size:.72rem;color:var(--cyan);font-weight:700;background:rgba(0,194,212,.08);padding:2px 8px;border-radius:20px;border:1px solid rgba(0,194,212,.2)}
.jcard-sections{display:flex;flex-wrap:wrap;gap:4px}
.jsec{padding:3px 8px;border-radius:5px;font-size:.68rem;font-weight:700;border:1px solid}
.jcard-detail{margin-top:10px;border-top:1px solid var(--border);padding-top:10px}
.jsec-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.76rem}
.jsec-time{font-family:"JetBrains Mono",monospace;color:var(--blue2);font-weight:500;min-width:42px;flex-shrink:0}
.jsec-icon{font-size:.9rem;flex-shrink:0}
.jsec-label{color:var(--text);flex:1}

/* ── VIEW: LIGNES ── */
.lines-wrap{padding:18px}
.line-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:11px 13px;margin-bottom:6px;animation:fadeUp .2s ease both;cursor:pointer;transition:background .12s}
.line-card:hover{background:var(--card2)}
.line-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.line-routes{font-size:.7rem;color:var(--muted)}

/* ── VIEW: SYSINFO ── */
.sysinfo-wrap{padding:18px}
.sysinfo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px}
.si-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.si-label{font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px}
.si-value{font-family:"JetBrains Mono",monospace;font-size:1.3rem;font-weight:700;color:var(--blue2);line-height:1}
.si-sub{font-size:.62rem;color:var(--muted);margin-top:3px}
.si-card.ok .si-value{color:var(--green)}
.si-card.warn .si-value{color:var(--orange)}

/* ── EMPTY / LOADING ── */
.center{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--muted);text-align:center;padding:40px}
.center-sm{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px;gap:10px;color:var(--muted);text-align:center}
.ico{font-size:2rem;opacity:.25}
.lbl{font-size:.85rem}
.sub{font-size:.68rem;color:#1e2d40}
.spin-lg{width:26px;height:26px;border:3px solid var(--border2);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite}

.refresh-bar{height:2px;background:var(--border);flex-shrink:0;position:relative}
.refresh-prog{position:absolute;left:0;top:0;bottom:0;background:var(--blue);transition:width .5s linear;border-radius:0 1px 1px 0}

@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>

<!-- TOPBAR -->
<div class="topbar">
  <div class="brand">🚄 <span>SNCF</span> OPS</div>
  <div class="clock" id="clock">--:--:--</div>
  <div class="sys-status"><div class="status-dot"></div>LIVE</div>

  <div class="search-wrap">
    <input type="text" id="search" placeholder="Gare d'observation…" autocomplete="off">
    <span class="search-icon" id="sico">⌕</span>
    <div class="spin-sm" id="sspin"></div>
    <div class="sugg" id="sugg"></div>
  </div>

  <div class="api-stats" id="apistats" title="Statistiques API">
    <div class="api-stat"><span>API</span><span class="api-stat-n" id="s-api">0</span></div>
    <div class="api-stat"><span>CACHE</span><span class="api-stat-n" id="s-cache">0</span></div>
    <div class="api-stat" id="s-err-wrap"><span>ERR</span><span class="api-stat-n" id="s-err">0</span></div>
  </div>

  <div class="top-tabs">
    <div class="ttab active" onclick="setDetailTab('train')">Trajet</div>
    <div class="ttab" onclick="setDetailTab('board')">Tableau</div>
    <div class="ttab" onclick="setDetailTab('schedules')">Horaires</div>
    <div class="ttab" onclick="setDetailTab('arrivals')">Arrivées</div>
    <div class="ttab" onclick="setDetailTab('journey')">Itinéraire</div>
    <div class="ttab" onclick="setDetailTab('lines')">Lignes</div>
    <div class="ttab" onclick="setDetailTab('disruptions')">Alertes <span class="cnt" id="disrup-cnt" style="display:none">0</span></div>
    <div class="ttab" onclick="setDetailTab('sysinfo')">Système</div>
  </div>
</div>

<div class="refresh-bar"><div class="refresh-prog" id="rprog"></div></div>

<div class="workspace">
  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-gare" id="sgare">Aucune gare</div>
      <div class="kpis" id="kpis" style="display:none">
        <div class="kpi ok"><div class="kpi-n" id="k-ok">0</div><div class="kpi-l">OK</div></div>
        <div class="kpi warn"><div class="kpi-n" id="k-late">0</div><div class="kpi-l">Retard</div></div>
        <div class="kpi danger"><div class="kpi-n" id="k-cancel">0</div><div class="kpi-l">Suppr.</div></div>
        <div class="kpi info"><div class="kpi-n" id="k-total">0</div><div class="kpi-l">Total</div></div>
      </div>
    </div>
    <div class="tlist" id="tlist">
      <div class="center">
        <div class="ico">🔍</div>
        <div class="lbl">Aucune gare sélectionnée</div>
        <div class="sub">Utilisez la barre de recherche</div>
      </div>
    </div>
  </div>

  <!-- DETAIL -->
  <div class="detail">
    <div class="vtabs">
      <div class="vtab active" data-v="train" onclick="switchVtab(this)">📍 Trajet</div>
      <div class="vtab" data-v="board" onclick="switchVtab(this)">📋 Départs</div>
      <div class="vtab" data-v="schedules" onclick="switchVtab(this)">🕐 Horaires</div>
      <div class="vtab" data-v="arrivals" onclick="switchVtab(this)">🚉 Arrivées</div>
      <div class="vtab" data-v="journey" onclick="switchVtab(this)">🧭 Itinéraire</div>
      <div class="vtab" data-v="lines" onclick="switchVtab(this)">🗺 Lignes</div>
      <div class="vtab" data-v="disruptions" onclick="switchVtab(this)">⚠️ Alertes</div>
      <div class="vtab" data-v="sysinfo" onclick="switchVtab(this)">⚙️ Système</div>
    </div>

    <div class="view active" id="view-train">
      <div class="center"><div class="ico">🚄</div><div class="lbl">Sélectionnez un train</div><div class="sub">Cliquez sur un départ à gauche</div></div>
    </div>
    <div class="view" id="view-board">
      <div class="center"><div class="ico">📋</div><div class="lbl">Sélectionnez une gare</div></div>
    </div>
    <div class="view" id="view-schedules">
      <div class="center"><div class="ico">🕐</div><div class="lbl">Sélectionnez une gare</div></div>
    </div>
    <div class="view" id="view-arrivals">
      <div class="center"><div class="ico">🚉</div><div class="lbl">Sélectionnez une gare</div></div>
    </div>
    <div class="view" id="view-journey">
      <div class="journey-wrap">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.1rem;letter-spacing:.12em;color:var(--cyan);margin-bottom:14px">🧭 CALCULATEUR D'ITINÉRAIRE</div>
        <div class="journey-search">
          <div class="journey-field">
            <label>Départ (ID gare)</label>
            <input type="text" id="j-from" placeholder="stop_area:SNCF:87... ou ex: Bordeaux">
          </div>
          <div class="journey-field">
            <label>Arrivée (ID gare)</label>
            <input type="text" id="j-to" placeholder="stop_area:SNCF:87... ou ex: Paris">
          </div>
          <button class="journey-btn" onclick="calcJourney()">Calculer →</button>
        </div>
        <div id="journey-result"></div>
      </div>
    </div>
    <div class="view" id="view-lines">
      <div class="center"><div class="ico">🗺</div><div class="lbl">Sélectionnez une gare</div></div>
    </div>
    <div class="view" id="view-disruptions">
      <div class="center"><div class="spin-lg"></div><div class="lbl">Chargement alertes réseau…</div></div>
    </div>
    <div class="view" id="view-sysinfo">
      <div class="center"><div class="spin-lg"></div><div class="lbl">Chargement…</div></div>
    </div>
  </div>
</div>

<script>
// ── GLOBALS ─────────────────────────────────────────
var G = {
  stop: null, deps: [], arrivals: [], selectedVj: null,
  refreshLeft: 30, refreshMax: 30, refreshTimer: null
};

// ── UTILS ────────────────────────────────────────────
function p2(n){return String(n).padStart(2,"0")}
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function fmtT(s){if(!s||s.length<13)return"--:--";return s.slice(9,11)+":"+s.slice(11,13)}
function fmtST(s){if(!s||s.length<4)return"--:--";var h=s.slice(0,2),m=s.slice(2,4);return(parseInt(h)>=24?p2(parseInt(h)-24):h)+":"+m}
function dur(s){var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?h+"h"+p2(m):m+"min"}

function getDelay(dep){
  var b=dep&&dep.stop_date_time&&dep.stop_date_time.base_departure_date_time;
  var a=dep&&dep.stop_date_time&&dep.stop_date_time.departure_date_time;
  if(!b||!a||b===a)return 0;
  return(parseInt(a.slice(9,11))*60+parseInt(a.slice(11,13)))-(parseInt(b.slice(9,11))*60+parseInt(b.slice(11,13)));
}
function getDelayST(b,a){
  if(!b||!a||b===a)return 0;
  var pb=parseInt(b.slice(0,2))*60+parseInt(b.slice(2,4));
  var pa=parseInt(a.slice(0,2))*60+parseInt(a.slice(2,4));
  var d=pa-pb;return d<-60?d+1440:d; // handle midnight crossing
}
function lineColor(info){
  if(info&&info.color)return"#"+info.color;
  var m=(info&&info.commercial_mode||"").toLowerCase();
  if(m.includes("tgv"))return"#c0092a";
  if(m.includes("ter")||m.includes("lio"))return"#e6007e";
  if(m.includes("intercit"))return"#0088ce";
  if(m.includes("transilien")||m.includes("rer"))return"#9c27b0";
  return"#2f80ed";
}
function getMat(h,m){
  var n=parseInt(h);
  if(n>=4600&&n<=4800)return"Corail BB26000";
  if(n>=870000&&n<=879999)return"Régiolis AGC";
  if(n>=9500&&n<=9800)return"TGV Duplex";
  if(n>=6000&&n<=6999)return"TGV Atlantique";
  if(m&&m.toLowerCase().includes("ter"))return"ZGC / X73500";
  return null;
}
function isCancelled(dep){
  return(dep.disruptions||[]).some(function(x){return x.severity&&x.severity.effect==="NO_SERVICE";});
}

// ── CLOCK ────────────────────────────────────────────
function tick(){
  var n=new Date();
  document.getElementById("clock").textContent=p2(n.getHours())+":"+p2(n.getMinutes())+":"+p2(n.getSeconds());
}
setInterval(tick,1000);tick();

// ── REFRESH BAR ──────────────────────────────────────
function tickRefresh(){
  G.refreshLeft--;
  var pct=((G.refreshMax-G.refreshLeft)/G.refreshMax)*100;
  document.getElementById("rprog").style.width=pct+"%";
  if(G.refreshLeft<=0){
    if(G.stop)loadDeps(G.stop.id,G.stop.name,false);
    G.refreshLeft=G.refreshMax;
  }
}
setInterval(tickRefresh,1000);

// ── API STATS ────────────────────────────────────────
async function refreshStats(){
  try{
    var r=await fetch("/api/stats");var d=await r.json();
    document.getElementById("s-api").textContent=d.api||0;
    document.getElementById("s-cache").textContent=d.cached||0;
    document.getElementById("s-err").textContent=d.errors||0;
    if((d.errors||0)>0)document.getElementById("s-err-wrap").classList.add("danger");
    if(document.getElementById("view-sysinfo").classList.contains("active"))renderSysInfo(d);
  }catch(e){}
}
setInterval(refreshStats,5000);refreshStats();

// ── TABS ─────────────────────────────────────────────
function switchVtab(el){
  document.querySelectorAll(".vtab").forEach(function(t){t.classList.remove("active")});
  document.querySelectorAll(".view").forEach(function(v){v.classList.remove("active")});
  el.classList.add("active");
  document.getElementById("view-"+el.dataset.v).classList.add("active");
  if(el.dataset.v==="arrivals"&&G.stop)loadArrivals(G.stop.id);
  if(el.dataset.v==="disruptions")loadDisruptions();
  if(el.dataset.v==="schedules"&&G.stop)loadSchedules(G.stop.id);
  if(el.dataset.v==="lines"&&G.stop)loadLines(G.stop.id);
  if(el.dataset.v==="sysinfo")refreshStats();
}
function setDetailTab(v){
  var el=document.querySelector(".vtab[data-v='"+v+"']");
  if(el)switchVtab(el);
  document.querySelectorAll(".ttab").forEach(function(t){t.classList.remove("active")});
  event.target.classList.add("active");
}

// ── SEARCH ───────────────────────────────────────────
var stimer=null;
document.getElementById("search").addEventListener("input",function(){
  clearTimeout(stimer);
  var q=this.value.trim();
  if(q.length<2){hideSugg();return;}
  document.getElementById("sspin").classList.add("on");
  document.getElementById("sico").style.display="none";
  stimer=setTimeout(function(){doSearch(q);},380);
});
document.addEventListener("click",function(e){if(!e.target.closest(".search-wrap"))hideSugg();});
function hideSugg(){document.getElementById("sugg").classList.remove("on");}

async function doSearch(q){
  try{
    var r=await fetch("/api/places?q="+encodeURIComponent(q));
    var d=await r.json();
   var stops = (d.places || [])
  .filter(p => p.embedded_type === "stop_area")
  .map(p => ({
    id: p.stop_area.id,
    name: p.stop_area.name,
    label: p.stop_area.label,
    coord: p.stop_area.coord
  }));
    if(!stops.length){hideSugg();return;}
    var html=stops.map(function(p){
      var s=p.stop_area||p;
      var reg=p.administrative_regions&&p.administrative_regions[0]&&p.administrative_regions[0].name||"";
      return'<div class="sug" data-id="'+esc(s.id)+'" data-name="'+esc(p.name)+'">'
        +'<span style="color:var(--blue2);font-size:.8rem">📍</span>'
        +'<span class="sug-name">'+esc(p.name)+'</span>'
        +(reg?'<span class="sug-region">'+esc(reg)+'</span>':"")
        +'</div>';
    }).join("");
    document.getElementById("sugg").innerHTML=html;
    document.getElementById("sugg").classList.add("on");
    document.querySelectorAll(".sug").forEach(function(el){
      el.addEventListener("click",function(){
        document.getElementById("search").value=this.dataset.name;
        hideSugg();
        loadDeps(this.dataset.id,this.dataset.name,true);
      });
    });
  }catch(e){hideSugg();}
  finally{
    document.getElementById("sspin").classList.remove("on");
    document.getElementById("sico").style.display="";
  }
}

// ── DEPARTURES ───────────────────────────────────────
async function loadDeps(stopId,name,showLoad){
  G.stop={id:stopId,name:name};
  G.refreshLeft=G.refreshMax;
  if(showLoad){
    document.getElementById("tlist").innerHTML='<div class="center"><div class="spin-lg"></div><div class="lbl">Chargement…</div></div>';
    document.getElementById("kpis").style.display="none";
  }
  try{
    var r=await fetch("/api/departures?stop="+encodeURIComponent(stopId));
    var d=await r.json();
    if(d.error)throw new Error(d.error);
    G.deps=d.departures||[];
    renderDeps(G.deps,name);
    renderBoard(G.deps,name);
    // Auto-charger aussi les horaires si l'onglet est actif
    var schedTab=document.querySelector(".vtab[data-v='schedules']");
    if(schedTab&&schedTab.classList.contains("active"))loadSchedules(stopId);
    var linesTab=document.querySelector(".vtab[data-v='lines']");
    if(linesTab&&linesTab.classList.contains("active"))loadLines(stopId);
  }catch(e){
    document.getElementById("tlist").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
  }
}

function renderDeps(deps,name){
  document.getElementById("sgare").textContent="📍 "+name;
  var nOk=0,nLate=0,nCancel=0;
  deps.forEach(function(d){
    var c=isCancelled(d);
    if(c)nCancel++;else if(getDelay(d)>0)nLate++;else nOk++;
  });
  document.getElementById("k-ok").textContent=nOk;
  document.getElementById("k-late").textContent=nLate;
  document.getElementById("k-cancel").textContent=nCancel;
  document.getElementById("k-total").textContent=deps.length;
  document.getElementById("kpis").style.display="flex";

  if(!deps.length){
    document.getElementById("tlist").innerHTML='<div class="center"><div class="ico">🚉</div><div class="lbl">Aucun départ</div></div>';
    return;
  }

  var html=deps.map(function(dep,i){
    var info=dep.display_informations||{};
    var dt=dep.stop_date_time||{};
    var delay=getDelay(dep);
    var canc=isCancelled(dep);
    var cause=(dep.disruptions&&dep.disruptions[0]&&dep.disruptions[0].cause)||"";
    var plat=dt.platform_code||null;
    var col=lineColor(info);
    var mat=getMat(info.headsign,info.commercial_mode);
    var links=dep.links||[];
    var vjl=links.find(function(l){return l.type==="vehicle_journey";});
    var vjId=vjl?vjl.id:"";

    var cls="tcard"+(canc?" cancelled":delay>=15?" verylate":delay>0?" late":"");
    var dc=canc?"var(--red)":delay>0?"var(--orange)":"var(--text)";

    var badges="";
    if(!canc&&delay===0)badges+='<span class="b b-ok">✓ A l&#39;heure</span>';
    if(!canc&&delay>0)badges+='<span class="b b-late">+'+delay+'&thinsp;min</span>';
    if(canc)badges+='<span class="b b-cancel">Supprimé</span>';
    if(cause)badges+='<span class="b-cause">⚠ '+esc(cause)+'</span>';

    return'<div class="'+cls+'" style="border-left-color:'+col+';animation-delay:'+(i*25)+'ms"'
      +' data-vjid="'+esc(vjId)+'" data-hs="'+esc(info.headsign||"")+'"'
      +' data-mode="'+esc(info.commercial_mode||"")+'" data-dir="'+esc(info.direction||"")+'"'
      +' data-col="'+esc(col)+'">'
      +'<div class="tc-row">'
        +'<div class="tc-left">'
          +'<div style="margin-bottom:2px"><span class="mode-chip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(info.commercial_mode||"TRAIN")+'</span>'
          +'<span class="tnum">'+esc(info.headsign||"—")+'</span></div>'
          +'<div class="tdir">→ '+esc((info.direction||"—").split("(")[0].trim())+'</div>'
          +'<div class="brow">'+badges+(mat?'<span style="color:#3d5475;font-size:.55rem;font-style:italic">· '+esc(mat)+'</span>':"")+'</div>'
        +'</div>'
        +'<div class="tc-right">'
          +'<div class="dtime" style="color:'+dc+'">'+(canc?"SUPP":fmtT(dt.departure_date_time))+'</div>'
          +(delay>0&&!canc?'<div class="dbase">'+fmtT(dt.base_departure_date_time)+'</div>':"")
          +(plat?'<div class="voie">Voie '+esc(plat)+'</div>':"")
        +'</div>'
      +'</div>'
      +'</div>';
  }).join("");

  document.getElementById("tlist").innerHTML=html;
  document.querySelectorAll(".tcard").forEach(function(el){
    el.addEventListener("click",function(){
      document.querySelectorAll(".tcard").forEach(function(c){c.classList.remove("sel");});
      this.classList.add("sel");
      // Switch to train tab
      document.querySelectorAll(".vtab").forEach(function(t){t.classList.remove("active");});
      document.querySelectorAll(".view").forEach(function(v){v.classList.remove("active");});
      document.querySelector(".vtab[data-v='train']").classList.add("active");
      document.getElementById("view-train").classList.add("active");
      showTrain(this.dataset.vjid,this.dataset.hs,this.dataset.mode,this.dataset.dir,this.dataset.col);
    });
  });
}

// ── BOARD ─────────────────────────────────────────────
function renderBoard(deps,name){
  if(!deps.length){
    document.getElementById("view-board").innerHTML='<div class="center"><div class="ico">📋</div><div class="lbl">Aucun départ</div></div>';
    return;
  }
  var rows=deps.map(function(dep){
    var info=dep.display_informations||{};
    var dt=dep.stop_date_time||{};
    var delay=getDelay(dep);
    var canc=isCancelled(dep);
    var col=lineColor(info);
    var dc=canc?"var(--red)":delay>0?"var(--orange)":"var(--text)";
    var links=dep.links||[];
    var vjl=links.find(function(l){return l.type==="vehicle_journey";});
    var vjId=vjl?vjl.id:"";

    return'<tr data-vjid="'+esc(vjId)+'" data-hs="'+esc(info.headsign||"")+'" data-mode="'+esc(info.commercial_mode||"")+'" data-dir="'+esc(info.direction||"")+'" data-col="'+esc(col)+'">'
      +'<td><span class="bt-time" style="color:'+dc+'">'+(canc?"—":fmtT(dt.departure_date_time))+'</span>'
      +(delay>0&&!canc?'<div class="bt-delay">'+fmtT(dt.base_departure_date_time)+'</div>':"")
      +'</td>'
      +'<td><span class="mode-chip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(info.commercial_mode||"?")+'</span>'
      +'<span style="font-family:JetBrains Mono,monospace;font-size:.75rem">'+esc(info.headsign||"")+'</span></td>'
      +'<td class="bt-dest">'+esc((info.direction||"—").split("(")[0].trim())+'</td>'
      +'<td class="bt-voie">'+(dt.platform_code||"—")+'</td>'
      +'<td>'+(canc?'<span class="st-cancel">SUPPRIMÉ</span>':delay>0?'<span class="st-late">+'+delay+'min</span>':'<span class="st-ok">A L&#39;HEURE</span>')+'</td>'
      +'</tr>';
  }).join("");

  document.getElementById("view-board").innerHTML=
    '<div class="board-wrap">'
    +'<div class="board-title">📋 DÉPARTS — '+esc(name)+'</div>'
    +'<table class="btable"><thead><tr><th>HEURE</th><th>TRAIN</th><th>DESTINATION</th><th>VOIE</th><th>ÉTAT</th></tr></thead><tbody>'+rows+'</tbody></table>'
    +'</div>';

  document.querySelectorAll(".btable tbody tr").forEach(function(tr){
    tr.addEventListener("click",function(){
      document.querySelectorAll(".vtab").forEach(function(t){t.classList.remove("active");});
      document.querySelectorAll(".view").forEach(function(v){v.classList.remove("active");});
      document.querySelector(".vtab[data-v='train']").classList.add("active");
      document.getElementById("view-train").classList.add("active");
      showTrain(this.dataset.vjid,this.dataset.hs,this.dataset.mode,this.dataset.dir,this.dataset.col);
    });
  });
}

// ── SCHEDULES ────────────────────────────────────────
async function loadSchedules(stopId){
  document.getElementById("view-schedules").innerHTML='<div class="center-sm"><div class="spin-lg"></div><div class="lbl">Chargement horaires…</div></div>';
  try{
    var r=await fetch("/api/schedules?stop="+encodeURIComponent(stopId));
    var d=await r.json();
    var scheds=d.stop_schedules||[];
    if(!scheds.length){
      document.getElementById("view-schedules").innerHTML='<div class="center"><div class="ico">🕐</div><div class="lbl">Aucun horaire</div></div>';
      return;
    }
    var html='<div class="sched-wrap">'
      +'<div class="board-title">🕐 HORAIRES PAR LIGNE — '+esc(G.stop&&G.stop.name||"")+'</div>';

    scheds.forEach(function(sc,i){
      var route=sc.route||{};
      var line=route.line||{};
      var col=line.color?"#"+line.color:"var(--blue)";
      var times=(sc.date_times||[]).map(function(dt){
        var rt=dt.data_freshness==="realtime";
        var base=dt.base_date_time,real=dt.date_time;
        var delay=base&&real&&base!==real?getDelayST(base.slice(9,15),real.slice(9,15)):0;
        var cls="sched-time-chip"+(rt&&delay>0?" late":rt?" realtime":"");
        var t=fmtT(real||base);
        return'<span class="'+cls+'" title="'+(rt?"Temps réel":"Théorique")+'">'
          +t+(delay>0?'<span style="font-size:.55rem;margin-left:2px">+'+delay+'</span>':'')+'</span>';
      }).join("");

      html+='<div class="sched-line" style="animation-delay:'+(i*30)+'ms">'
        +'<div class="sched-head">'
          +'<span class="mode-chip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(line.commercial_mode&&line.commercial_mode.name||line.name||"LIGNE")+'</span>'
          +'<span style="font-weight:700;font-size:.85rem">'+esc(line.code||line.name||"")+'</span>'
          +'<span style="color:var(--muted);font-size:.72rem;flex:1">→ '+esc(route.direction&&route.direction.stop_area&&route.direction.stop_area.name||route.name||"")+'</span>'
        +'</div>'
        +(times?'<div class="sched-times">'+times+'</div>':'<div style="color:var(--muted);font-size:.72rem">Pas de départ imminent</div>')
        +'</div>';
    });
    html+='</div>';
    document.getElementById("view-schedules").innerHTML=html;
  }catch(e){
    document.getElementById("view-schedules").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
  }
}

// ── ARRIVALS ─────────────────────────────────────────
async function loadArrivals(stopId){
  document.getElementById("view-arrivals").innerHTML='<div class="center-sm"><div class="spin-lg"></div><div class="lbl">Chargement arrivées…</div></div>';
  try{
    var r=await fetch("/api/arrivals?stop="+encodeURIComponent(stopId));
    var d=await r.json();
    var arrs=d.arrivals||[];
    if(!arrs.length){
      document.getElementById("view-arrivals").innerHTML='<div class="center"><div class="ico">🚉</div><div class="lbl">Aucune arrivée</div></div>';
      return;
    }
    var rows=arrs.map(function(arr){
      var info=arr.display_informations||{};
      var dt=arr.stop_date_time||{};
      var baseA=dt.base_arrival_date_time,realA=dt.arrival_date_time;
      var delay=baseA&&realA&&baseA!==realA?(parseInt(realA.slice(9,11))*60+parseInt(realA.slice(11,13)))-(parseInt(baseA.slice(9,11))*60+parseInt(baseA.slice(11,13))):0;
      var col=lineColor(info);
      var canc=isCancelled(arr);
      return'<tr><td><span class="bt-time" style="color:'+(canc?"var(--red)":delay>0?"var(--orange)":"var(--text)")+'">'+fmtT(realA)+'</span>'
        +(delay>0?'<div class="bt-delay">'+fmtT(baseA)+'</div>':"")+'</td>'
        +'<td><span class="mode-chip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(info.commercial_mode||"?")+'</span>'
        +'<span style="font-family:JetBrains Mono,monospace;font-size:.75rem">'+esc(info.headsign||"")+'</span></td>'
        +'<td class="bt-dest" style="color:#5a7a9a">De '+esc((info.direction||"—").split("(")[0].trim())+'</td>'
        +'<td class="bt-voie">'+(dt.platform_code||"—")+'</td>'
        +'<td>'+(canc?'<span class="st-cancel">SUPPRIMÉ</span>':delay>0?'<span class="st-late">+'+delay+'min</span>':'<span class="st-ok">A L&#39;HEURE</span>')+'</td>'
        +'</tr>';
    }).join("");
    document.getElementById("view-arrivals").innerHTML=
      '<div class="board-wrap"><div class="board-title">🚉 ARRIVÉES — '+esc(G.stop&&G.stop.name||"")+'</div>'
      +'<table class="btable"><thead><tr><th>HEURE</th><th>TRAIN</th><th>PROVENANCE</th><th>VOIE</th><th>ÉTAT</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }catch(e){
    document.getElementById("view-arrivals").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
  }
}

// ── DISRUPTIONS ───────────────────────────────────────
async function loadDisruptions(){
  document.getElementById("view-disruptions").innerHTML='<div class="center-sm"><div class="spin-lg"></div><div class="lbl">Chargement alertes…</div></div>';
  try{
    var r=await fetch("/api/disruptions");
    var d=await r.json();
    var list=d.disruptions||[];
    var cnt=document.getElementById("disrup-cnt");
    cnt.textContent=list.length;
    cnt.style.display=list.length>0?"":"none";

    if(!list.length){
      document.getElementById("view-disruptions").innerHTML='<div class="center"><div class="ico">✅</div><div class="lbl">Aucune perturbation</div><div class="sub">Réseau nominal</div></div>';
      return;
    }

    var html='<div class="disrup-wrap"><div class="board-title">⚠️ PERTURBATIONS RÉSEAU ('+list.length+')</div>';
    html+=list.map(function(d,i){
      var eff=d.severity&&d.severity.effect||"";
      var cause=d.cause||"";
      var msg=d.messages&&d.messages[0]&&(d.messages[0].text||d.messages[0].value)||"";
      var isSev=eff==="NO_SERVICE"||eff==="SIGNIFICANT_DELAYS";
      var isLow=eff==="UNKNOWN_EFFECT"||eff==="ACCESSIBILITY_INVESTIGATION";
      var effLbl=eff==="NO_SERVICE"?"TRAFIC INTERROMPU":eff==="SIGNIFICANT_DELAYS"?"RETARDS IMPORTANTS":eff==="REDUCED_SERVICE"?"SERVICE RÉDUIT":"INFORMATION";
      var effCls=isSev?"eff-stop":isLow?"eff-ok":"eff-delay";
      var obj=d.impacted_objects&&d.impacted_objects[0];
      var netw=obj&&obj.pt_object&&obj.pt_object.name||"";
      var lines=(d.impacted_objects||[]).slice(0,3).map(function(o){return o.pt_object&&o.pt_object.name||"";}).filter(Boolean).join(", ");

      return'<div class="disrup-card'+(isSev?" sev":isLow?" low":"")+ '" style="animation-delay:'+(i*30)+'ms">'
        +'<div class="disrup-title">'+esc(cause||(msg&&msg.slice(0,70))||"Perturbation réseau")+'</div>'
        +'<div class="disrup-meta">'
          +(lines?'<span>🚆 '+esc(lines)+'</span>':"")
          +(netw&&!lines?'<span>📍 '+esc(netw)+'</span>':"")
        +'</div>'
        +(msg?'<div class="disrup-msg">'+esc(msg)+'</div>':"")
        +'<div><span class="eff-chip '+effCls+'">'+effLbl+'</span></div>'
        +'</div>';
    }).join("");
    html+='</div>';
    document.getElementById("view-disruptions").innerHTML=html;
  }catch(e){
    document.getElementById("view-disruptions").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
  }
}

// ── LINES ─────────────────────────────────────────────
async function loadLines(stopId){
  document.getElementById("view-lines").innerHTML='<div class="center-sm"><div class="spin-lg"></div><div class="lbl">Chargement lignes…</div></div>';
  try{
    var r=await fetch("/api/lines?stop="+encodeURIComponent(stopId));
    var d=await r.json();
    var lines=d.lines||[];
    if(!lines.length){
      document.getElementById("view-lines").innerHTML='<div class="center"><div class="ico">🗺</div><div class="lbl">Aucune ligne</div></div>';
      return;
    }
    var html='<div class="lines-wrap"><div class="board-title">🗺 LIGNES — '+esc(G.stop&&G.stop.name||"")+'</div>';
    html+=lines.map(function(l,i){
      var col=l.color?"#"+l.color:"var(--blue)";
      var routes=(l.routes||[]).slice(0,3).map(function(ro){
        return ro.direction&&ro.direction.stop_area&&ro.direction.stop_area.name||ro.name||"";
      }).filter(Boolean).join(" · ");
      return'<div class="line-card" style="animation-delay:'+(i*20)+'ms">'
        +'<div class="line-head">'
          +'<span class="mode-chip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(l.commercial_mode&&l.commercial_mode.name||"LIGNE")+'</span>'
          +'<span style="font-weight:700;font-size:.9rem">'+esc(l.code||l.name||"")+'</span>'
          +'<span style="color:var(--muted);font-size:.72rem;flex:1">'+esc(l.name||"")+'</span>'
          +(l.opening_time&&l.closing_time?'<span style="font-family:JetBrains Mono,monospace;font-size:.62rem;color:var(--muted)">'+l.opening_time.slice(0,2)+":"+l.opening_time.slice(2,4)+" – "+l.closing_time.slice(0,2)+":"+l.closing_time.slice(2,4)+'</span>':"")
        +'</div>'
        +(routes?'<div class="line-routes">↔ '+esc(routes)+'</div>':"")
        +'</div>';
    }).join("");
    html+='</div>';
    document.getElementById("view-lines").innerHTML=html;
  }catch(e){
    document.getElementById("view-lines").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
  }
}

// ── JOURNEY ───────────────────────────────────────────
async function calcJourney(){
  var from=document.getElementById("j-from").value.trim();
  var to=document.getElementById("j-to").value.trim();
  if(!from||!to){document.getElementById("journey-result").innerHTML='<div style="color:var(--orange);font-size:.8rem;padding:10px">Renseignez le départ et l\'arrivée.</div>';return;}
  document.getElementById("journey-result").innerHTML='<div class="center-sm"><div class="spin-lg"></div><div class="lbl">Calcul en cours…</div></div>';
  try{
    var r=await fetch("/api/journeys?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to));
    var d=await r.json();
    var journeys=d.journeys||[];
    if(!journeys.length){
      document.getElementById("journey-result").innerHTML='<div style="color:var(--muted);padding:20px;font-size:.82rem">Aucun itinéraire trouvé. Utilisez des IDs de stop_area (ex: stop_area:SNCF:87...).</div>';
      return;
    }
    var html=journeys.map(function(j,i){
      var dep=j.departure_date_time,arr=j.arrival_date_time;
      var dH=dep?dep.slice(9,11)+":"+dep.slice(11,13):"?";
      var aH=arr?arr.slice(9,11)+":"+arr.slice(11,13):"?";
      var sections=(j.sections||[]);
      var secChips=sections.map(function(s){
        if(s.type==="waiting")return'<span class="jsec" style="background:rgba(255,255,255,.04);color:var(--muted);border-color:var(--border)">⏳ '+(Math.round((s.duration||0)/60))+'min</span>';
        if(s.type==="crow_fly"||s.type==="street_network")return'<span class="jsec" style="background:rgba(0,194,212,.06);color:var(--cyan);border-color:rgba(0,194,212,.2)">🚶 '+(Math.round((s.duration||0)/60))+'min</span>';
        if(s.type==="public_transport"){
          var info=s.display_informations||{};
          var col=lineColor(info);
          return'<span class="jsec" style="background:'+col+'15;color:'+col+';border-color:'+col+'30">'+esc(info.commercial_mode||"🚄")+'&nbsp;'+esc(info.headsign||info.label||"")+'</span>';
        }
        return"";
      }).filter(Boolean).join("");

      var detail=sections.map(function(s,si){
        if(s.type==="waiting")return'<div class="jsec-row"><span class="jsec-time">&nbsp;</span><span class="jsec-icon">⏳</span><span class="jsec-label" style="color:var(--muted)">Correspondance '+(Math.round((s.duration||0)/60))+'min</span></div>';
        if(s.type==="street_network"||s.type==="crow_fly")return'<div class="jsec-row"><span class="jsec-time">'+(s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"")+'</span><span class="jsec-icon">🚶</span><span class="jsec-label">A pied · '+(Math.round((s.duration||0)/60))+'min</span></div>';
        if(s.type==="public_transport"){
          var info=s.display_informations||{};
          var col=lineColor(info);
          var from2=s.from&&s.from.stop_point&&s.from.stop_point.name||s.from&&s.from.name||"";
          var to2=s.to&&s.to.stop_point&&s.to.stop_point.name||s.to&&s.to.name||"";
          var dT2=s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"";
          return'<div class="jsec-row"><span class="jsec-time">'+dT2+'</span>'
            +'<span class="jsec-icon">🚄</span>'
            +'<span class="jsec-label"><strong style="color:'+col+'">'+esc(info.commercial_mode||"")+'&nbsp;'+esc(info.headsign||"")+'</strong>'
            +' <span style="color:var(--muted)">'+esc(from2)+'</span>'
            +' → <strong>'+esc(to2)+'</strong>'
            +(info.direction?' <span style="color:var(--muted);font-size:.7rem">(dir. '+esc((info.direction||"").split("(")[0].trim())+')</span>':"")
            +'</span></div>';
        }
        return"";
      }).filter(Boolean).join("");

      return'<div class="jcard" style="animation-delay:'+(i*60)+'ms">'
        +'<div class="jcard-head">'
          +'<div><div class="jcard-time">'+dH+' → '+aH+'</div>'
          +'<div style="font-size:.7rem;color:var(--muted);margin-top:2px">'+(j.nb_transfers||0)+' correspondance'+(j.nb_transfers!==1?"s":"")+'</div></div>'
          +'<div class="jcard-dur">'+dur(j.duration||0)+'</div>'
        +'</div>'
        +'<div class="jcard-sections">'+secChips+'</div>'
        +'<div class="jcard-detail">'+detail+'</div>'
        +'</div>';
    }).join("");
    document.getElementById("journey-result").innerHTML=html;
  }catch(e){
    document.getElementById("journey-result").innerHTML='<div style="color:var(--red);padding:12px;font-size:.8rem">⚠️ '+esc(e.message)+'</div>';
  }
}

// ── SYSINFO ────────────────────────────────────────────
function renderSysInfo(d){
  var saved=d.cached||0;
  var total=d.total||0;
  var apiCalls=d.api||0;
  var uptime=d.uptime||0;
  var h=Math.floor(uptime/3600),m=Math.floor((uptime%3600)/60),s=uptime%60;
  var uptimeStr=(h>0?h+"h ":"")+m+"min "+s+"s";

  document.getElementById("view-sysinfo").innerHTML=
    '<div class="sysinfo-wrap">'
    +'<div class="board-title">⚙️ SYSTÈME & QUOTA API</div>'
    +'<div class="sysinfo-grid">'
      +'<div class="si-card ok"><div class="si-label">Requêtes cachées</div><div class="si-value">'+saved+'</div><div class="si-sub">Économies sur quota</div></div>'
      +'<div class="si-card"><div class="si-label">Appels API réels</div><div class="si-value">'+apiCalls+'</div><div class="si-sub">Sur ~5000/mois</div></div>'
      +'<div class="si-card"><div class="si-label">Requêtes totales</div><div class="si-value">'+total+'</div><div class="si-sub">Depuis démarrage</div></div>'
      +'<div class="si-card '+(d.errors>0?"warn":"ok")+'"><div class="si-label">Erreurs</div><div class="si-value">'+(d.errors||0)+'</div><div class="si-sub">Erreurs réseau</div></div>'
      +'<div class="si-card"><div class="si-label">Cache actif</div><div class="si-value">'+(d.cacheSize||0)+'</div><div class="si-sub">Entrées en mémoire</div></div>'
      +'<div class="si-card ok"><div class="si-label">Uptime</div><div class="si-value" style="font-size:.9rem">'+uptimeStr+'</div><div class="si-sub">Depuis démarrage</div></div>'
    +'</div>'
    +'<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;margin-top:4px">'
      +'<div style="font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px">STRATÉGIE CACHE</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.72rem">'
        +'<div style="color:var(--text)">🔍 Recherche gares</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">5 min</div>'
        +'<div style="color:var(--text)">🚄 Départs (temps réel)</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">20 sec</div>'
        +'<div style="color:var(--text)">🚉 Arrivées</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">20 sec</div>'
        +'<div style="color:var(--text)">🕐 Horaires</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">20 sec</div>'
        +'<div style="color:var(--text)">🛑 Détail trajet</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">30 sec</div>'
        +'<div style="color:var(--text)">⚠️ Perturbations</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">1 min</div>'
        +'<div style="color:var(--text)">🗺 Lignes</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">10 min</div>'
        +'<div style="color:var(--text)">🧭 Itinéraires</div><div style="color:var(--blue2);font-family:JetBrains Mono,monospace">2 min</div>'
      +'</div>'
    +'</div>'
    +'</div>';
}

// ── TRAIN DETAIL ──────────────────────────────────────
async function showTrain(vjId,hs,mode,dir,col){
  document.getElementById("view-train").innerHTML='<div class="center"><div class="spin-lg"></div><div class="lbl">Chargement trajet…</div></div>';
  if(!vjId){
    document.getElementById("view-train").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">ID introuvable</div></div>';
    return;
  }
  try{
    var r=await fetch("/api/vehicle?id="+encodeURIComponent(vjId));
    var d=await r.json();
    var vj=d.vehicle_journeys&&d.vehicle_journeys[0];
    if(!vj)throw new Error("Trajet introuvable");

    var disrup=d.disruptions&&d.disruptions[0];
    var impacted=(disrup&&disrup.impacted_objects&&disrup.impacted_objects[0]&&disrup.impacted_objects[0].impacted_stops)||[];
    var disrupMsg=(disrup&&disrup.messages&&disrup.messages[0]&&(disrup.messages[0].text||disrup.messages[0].value))||disrup&&disrup.cause||"";
    var mat=getMat(hs,mode);
    var stops=vj.stop_times||[];

    // Delay chart data
    var delayData=stops.map(function(st){
      var imp=impacted.find(function(x){return x.stop_point&&x.stop_point.id===st.stop_point.id;});
      var bT=imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
      var aT=imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
      return{name:(st.stop_point&&st.stop_point.name||"?"),delay:getDelayST(bT,aT)};
    });
    var maxDelay=delayData.reduce(function(m,d){return Math.max(m,d.delay);},0);

    // Hero
    var heroHTML='<div class="train-hero" data-num="'+esc(hs)+'">'
      +'<div class="hero-num" style="color:'+col+'">'+esc(hs)+'</div>'
      +'<div class="hero-dir">→ '+esc((dir||"").split("(")[0].trim())+'</div>'
      +'<div class="hero-badges">'
        +'<span class="hbadge" style="background:'+col+'15;color:'+col+';border-color:'+col+'30">'+esc(mode)+'</span>'
        +(mat?'<span class="hbadge" style="background:#0f2040;color:#5ba3f5;border-color:#1a3566">'+esc(mat)+'</span>':"")
        +'<span class="hbadge" style="background:#0d1c2e;color:var(--muted);border-color:var(--border)">'+stops.length+' arrêts</span>'
        +(maxDelay>0?'<span class="hbadge" style="background:rgba(255,145,0,.08);color:var(--orange);border-color:rgba(255,145,0,.2)">+'+maxDelay+'min max</span>':"")
      +'</div>'
      +'</div>';

    var alertHTML='<div class="alert-box'+(disrupMsg?" on":"")+'"><strong>⚡ PERTURBATION</strong>'+esc(disrupMsg)+'</div>';

    // Chart
    var chartHTML="";
    if(maxDelay>0){
      var bars=delayData.map(function(d){
        var pct=maxDelay>0?Math.round((d.delay/maxDelay)*100):0;
        var bc=d.delay>=15?"var(--red)":d.delay>0?"var(--orange)":"var(--border2)";
        return'<div class="cbar-wrap"><div class="cbar" style="height:'+pct+'%;background:'+bc+'" title="'+esc(d.name)+' : '+d.delay+'min"></div>'
          +'<div class="cbar-lbl">'+esc(d.name.split(" ")[0])+'</div></div>';
      }).join("");
      chartHTML='<div class="chart-wrap on"><div class="chart-title">📊 Évolution retard par arrêt</div><div class="chart-bars">'+bars+'</div></div>';
    }

    // Timeline
    var prevDelay=0,delayStarted=false;
    var tlHTML='<div class="timeline">';
    stops.forEach(function(st,i){
      var isFirst=i===0,isLast=i===stops.length-1;
      var imp=impacted.find(function(x){return x.stop_point&&x.stop_point.id===st.stop_point.id;});
      var bT=imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
      var aT=imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
      var delay=getDelayST(bT,aT);
      var plat=(st.stop_point&&st.stop_point.platform_code)||(imp&&imp.stop_point&&imp.stop_point.platform_code)||null;
      var isImp=delay>0;
      var isOrigin=isImp&&!delayStarted;
      var isCatch=isImp&&delay<prevDelay&&prevDelay>0;
      if(isImp)delayStarted=true;

      var dotCls="tl-dot"+(isFirst?" first":isLast?" last":isOrigin?" origin":isImp?" impacted":"");
      var segCls="tl-seg"+(isImp?" imp":"");

      tlHTML+='<div class="tl-stop" style="animation-delay:'+(i*12)+'ms">'
        +'<div class="tl-col"><div class="'+dotCls+'"></div>'+(!isLast?'<div class="'+segCls+'"></div>':"")+'</div>'
        +'<div class="tl-content">'
          +(isOrigin?'<div class="tl-incident">⚡ Gare d&#39;incident</div>':"")
          +'<div class="tl-row">'
            +'<span class="tl-name">'+esc(st.stop_point&&st.stop_point.name||"—")+'</span>'
            +(plat?'<span class="tl-voie">Voie '+esc(plat)+'</span>':"")
          +'</div>'
          +'<div class="tl-times">'
            +'<span class="tl-time">'+fmtST(aT)+'</span>'
            +(delay>0?'<span class="tl-base">'+fmtST(bT)+'</span>':"")
            +(delay>0?'<span class="tl-delay">+'+delay+'&thinsp;min</span>':"")
            +(isCatch?'<span class="tl-catch">-'+(prevDelay-delay)+'min rattrapé</span>':"")
          +'</div>'
        +'</div>'
        +'</div>';
      prevDelay=delay;
    });
    tlHTML+="</div>";

    document.getElementById("view-train").innerHTML=heroHTML+alertHTML+chartHTML+tlHTML;
  }catch(e){
    document.getElementById("view-train").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
  }
}

// ── INIT ──────────────────────────────────────────────
loadDisruptions();
</script>
</body>
</html>`;
