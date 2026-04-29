#!/usr/bin/env node

const http = require("http");
const https = require("https");
const url = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT = process.env.PORT || 3333;

if (!API_KEY) {
  console.error("❌ Clé API manquante ! Ajoute SNCF_API_KEY dans Render.");
  process.exit(1);
}

// Cache simple
const cache = new Map();
function cget(k) { const e = cache.get(k); if (!e || Date.now() - e.t > e.ttl) { cache.delete(k); return null; } return e.d; }
function cset(k, d, ttl) { cache.set(k, { d, t: Date.now(), ttl }); }

const pad = n => String(n).padStart(2, "0");
function nowDT() {
  const n = new Date();
  return n.getFullYear() + pad(n.getMonth()+1) + pad(n.getDate()) + "T" + pad(n.getHours()) + pad(n.getMinutes()) + "00";
}

function proxySNCF(path) {
  const cached = cget(path);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.sncf.com",
      path: "/v1/coverage/sncf/" + path,
      headers: { Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64") }
    };
    https.get(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          cset(path, parsed, 20000);
          resolve(parsed);
        } catch(e) { reject(e); }
      });
    }).on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const q = parsed.query;

  if (parsed.pathname === "/") { res.setHeader("Content-Type","text/html; charset=utf-8"); res.end(HTML); return; }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    let data;
    if (parsed.pathname === "/api/places") {
      console.log("🔍 Recherche:", q.q);
      data = await proxySNCF("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area&count=8");
      console.log("✅", (data.places||[]).length, "résultat(s)");
    }
    else if (parsed.pathname === "/api/departures") {
      data = await proxySNCF("stop_areas/" + encodeURIComponent(q.stop) + "/departures?from_datetime=" + nowDT() + "&count=40&data_freshness=realtime&depth=2");
      console.log("🚄", (data.departures||[]).length, "départs");
    }
    else if (parsed.pathname === "/api/arrivals") {
      data = await proxySNCF("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?from_datetime=" + nowDT() + "&count=40&data_freshness=realtime&depth=2");
    }
    else if (parsed.pathname === "/api/vehicle") {
      data = await proxySNCF("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=realtime");
    }
    else if (parsed.pathname === "/api/disruptions") {
      data = await proxySNCF("disruptions?count=100&depth=2");
    }
    else if (parsed.pathname === "/api/schedules") {
      data = await proxySNCF("stop_areas/" + encodeURIComponent(q.stop) + "/stop_schedules?from_datetime=" + nowDT() + "&data_freshness=realtime&items_per_schedule=3&depth=2");
    }
    else if (parsed.pathname === "/api/lines") {
      data = await proxySNCF("stop_areas/" + encodeURIComponent(q.stop) + "/lines?depth=2");
    }
    else { res.writeHead(404); res.end("{}"); return; }
    res.end(JSON.stringify(data));
  } catch(e) {
    console.error("❌", e.message);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, async () => {
  console.log("🚄 SNCF OPS CENTER — http://localhost:" + PORT);
  try {
    const d = await proxySNCF("places?q=paris&type[]=stop_area&count=1");
    console.log(d.places ? "✅ API SNCF OK !" : "⚠️ " + JSON.stringify(d).slice(0,80));
  } catch(e) { console.log("❌ " + e.message); }
});

const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNCF OPS CENTER</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#030712;--card:rgba(17,24,39,.7);--accent:#38bdf8;--border:rgba(255,255,255,.1);--text:#f9fafb;--late:#fb923c;--crit:#f87171;--green:#10b981}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:"DM Sans",sans-serif;display:flex;flex-direction:column}

/* TOPBAR */
.topbar{height:50px;background:rgba(0,0,0,.5);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:16px;flex-shrink:0;position:relative;z-index:1000}
.brand{font-family:"Bebas Neue",sans-serif;font-size:1.2rem;letter-spacing:.1em;color:var(--accent);white-space:nowrap;flex-shrink:0}
.clock{font-family:"JetBrains Mono",monospace;font-size:.85rem;color:var(--accent);white-space:nowrap;flex-shrink:0;min-width:72px}
.live{display:flex;align-items:center;gap:5px;font-size:.65rem;font-weight:700;color:var(--green);flex-shrink:0}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:blink 1.5s ease infinite}

/* SEARCH */
.search-wrap{flex:1;max-width:380px;position:relative}
.search-input{width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:10px;padding:8px 14px;color:#fff;font-size:.88rem;font-family:"DM Sans",sans-serif;outline:none;transition:border-color .2s}
.search-input:focus{border-color:var(--accent)}
.search-input::placeholder{color:rgba(255,255,255,.3)}
.sugg{position:absolute;top:calc(100% + 6px);left:0;right:0;background:#0c1627;border:1px solid rgba(56,189,248,.3);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.8);overflow:hidden;display:none;z-index:9999}
.sugg.on{display:block}
.sug{padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06);font-size:.85rem;display:flex;align-items:center;gap:8px;transition:background .1s}
.sug:last-child{border-bottom:none}
.sug:hover{background:rgba(56,189,248,.1)}
.sug-name{flex:1}
.sug-region{font-size:.7rem;color:rgba(255,255,255,.4)}

/* TABS */
.tabs{display:flex;gap:2px;margin-left:auto;flex-shrink:0}
.tab{padding:5px 11px;border-radius:6px;font-size:.65rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;color:rgba(255,255,255,.4);border:1px solid transparent;white-space:nowrap;transition:all .15s}
.tab:hover{color:#fff;background:rgba(255,255,255,.06)}
.tab.active{color:var(--accent);background:rgba(56,189,248,.1);border-color:rgba(56,189,248,.3)}

/* LAYOUT */
.workspace{flex:1;display:flex;overflow:hidden}
.sidebar{width:400px;min-width:400px;background:rgba(0,0,0,.4);backdrop-filter:blur(20px);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sidebar-head{padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
.gare-label{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:6px}
.kpis{display:flex;gap:6px}
.kpi{flex:1;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:7px 10px;text-align:center}
.kpi-n{font-family:"JetBrains Mono",monospace;font-size:1.3rem;font-weight:700;line-height:1}
.kpi-l{font-size:.55rem;color:rgba(255,255,255,.4);margin-top:2px;text-transform:uppercase}
.kpi.ok .kpi-n{color:var(--green)}.kpi.warn .kpi-n{color:var(--late)}.kpi.danger .kpi-n{color:var(--crit)}.kpi.info .kpi-n{color:var(--accent)}

.train-list{flex:1;overflow-y:auto;padding:10px}
.train-list::-webkit-scrollbar{width:3px}
.train-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}

/* TRAIN CARD */
.card{background:rgba(17,24,39,.7);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:14px;padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:all .2s;animation:fadeUp .25s ease both;position:relative}
.card:hover{background:rgba(255,255,255,.05);transform:translateX(3px)}
.card.sel{border-color:var(--accent);box-shadow:0 0 0 1px rgba(56,189,248,.3)}
.card.late{border-left-color:var(--late)}
.card.verylate{border-left-color:var(--crit)}
.card.cancelled{border-left-color:var(--crit);opacity:.5}

.card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.card-left{flex:1;min-width:0}
.card-right{text-align:right;flex-shrink:0}

.mode-chip{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:.58rem;font-weight:700;padding:1px 6px;border-radius:4px;letter-spacing:.08em;margin-right:5px;vertical-align:middle}
.train-num{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:.95rem;vertical-align:middle}
.train-dir{font-size:.78rem;color:rgba(255,255,255,.5);margin:3px 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badges{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.badge{font-size:.6rem;font-weight:700;padding:1px 6px;border-radius:20px}
.b-ok{background:rgba(16,185,129,.1);color:var(--green);border:1px solid rgba(16,185,129,.25)}
.b-late{background:rgba(251,146,60,.1);color:var(--late);border:1px solid rgba(251,146,60,.25)}
.b-cancel{background:rgba(248,113,113,.1);color:var(--crit);border:1px solid rgba(248,113,113,.25)}
.b-cause{color:rgba(255,255,255,.3);font-size:.58rem}
.dep-time{font-family:"JetBrains Mono",monospace;font-size:1.6rem;font-weight:700;line-height:1;margin-bottom:2px}
.dep-base{font-family:"JetBrains Mono",monospace;font-size:.7rem;color:rgba(255,255,255,.35);text-decoration:line-through}
.voie-badge{display:inline-block;margin-top:5px;background:#fff;color:#000;font-weight:900;padding:2px 8px;border-radius:6px;font-size:.75rem;font-family:"JetBrains Mono",monospace}

/* DETAIL */
.detail{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
.vtabs{display:flex;border-bottom:1px solid var(--border);background:rgba(0,0,0,.3);padding:0 16px;flex-shrink:0;overflow-x:auto}
.vtabs::-webkit-scrollbar{height:2px}
.vtab{padding:11px 12px;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.4);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;flex-shrink:0}
.vtab:hover{color:#fff}.vtab.active{color:var(--accent);border-bottom-color:var(--accent)}
.view{display:none;flex:1;overflow-y:auto}
.view.active{display:block}
.view::-webkit-scrollbar{width:4px}
.view::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}

/* HERO TRAIN */
.train-hero{padding:28px 32px 20px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(56,189,248,.05),transparent);position:relative;overflow:hidden}
.train-hero::before{content:attr(data-num);position:absolute;right:-10px;top:-10px;font-family:"Bebas Neue",sans-serif;font-size:9rem;color:rgba(255,255,255,.025);pointer-events:none;line-height:1}
.hero-num{font-family:"Bebas Neue",sans-serif;font-size:4rem;line-height:1;margin-bottom:4px}
.hero-dir{font-size:1rem;color:rgba(255,255,255,.5);margin-bottom:12px}
.hero-badges{display:flex;gap:7px;flex-wrap:wrap}
.hbadge{padding:3px 10px;border-radius:6px;font-size:.7rem;font-weight:700;border:1px solid}

.alert-box{margin:16px 32px;background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.25);border-left:3px solid var(--crit);border-radius:8px;padding:12px 16px;font-size:.82rem;color:#fca5a5;display:none}
.alert-box.on{display:block}
.alert-box strong{color:var(--crit);display:block;margin-bottom:3px;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase}

/* CHART */
.chart-wrap{margin:14px 32px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:14px;display:none}
.chart-wrap.on{display:block}
.chart-title{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.4);margin-bottom:10px}
.chart-bars{display:flex;align-items:flex-end;gap:2px;height:52px;padding-bottom:16px}
.cbar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;position:relative}
.cbar{width:100%;border-radius:2px 2px 0 0;min-height:2px}
.cbar-lbl{position:absolute;bottom:-14px;font-size:.42rem;color:rgba(255,255,255,.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30px;text-align:center}

/* TIMELINE */
.timeline{padding:20px 32px 40px}
.tl-stop{display:flex;gap:14px;animation:fadeUp .18s ease both}
.tl-col{display:flex;flex-direction:column;align-items:center;width:14px;flex-shrink:0;padding-top:5px}
.tl-dot{width:9px;height:9px;border-radius:50%;border:2px solid rgba(255,255,255,.2);background:var(--bg);flex-shrink:0}
.tl-dot.first{background:#10b981;border-color:#10b981;box-shadow:0 0 8px rgba(16,185,129,.5)}
.tl-dot.last{background:var(--crit);border-color:var(--crit);box-shadow:0 0 8px rgba(248,113,113,.5)}
.tl-dot.impacted{border-color:var(--late);box-shadow:0 0 6px rgba(251,146,60,.4)}
.tl-dot.origin{background:var(--crit);border-color:var(--crit);box-shadow:0 0 10px rgba(248,113,113,.6)}
.tl-seg{width:1px;flex:1;min-height:18px;background:rgba(255,255,255,.1);margin:2px 0}
.tl-seg.imp{background:rgba(251,146,60,.3)}
.tl-content{flex:1;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.05)}
.tl-stop:last-child .tl-content{border-bottom:none}
.tl-name{font-size:.88rem;font-weight:600;margin-bottom:3px}
.tl-incident{font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--crit);margin-bottom:3px}
.tl-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.tl-times{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tl-time{font-family:"JetBrains Mono",monospace;font-size:.9rem;font-weight:500;color:var(--accent)}
.tl-base{font-family:"JetBrains Mono",monospace;font-size:.7rem;color:rgba(255,255,255,.35);text-decoration:line-through}
.tl-delay{font-size:.68rem;font-weight:700;color:var(--late)}
.tl-catch{font-size:.62rem;font-weight:700;color:var(--green);background:rgba(16,185,129,.08);padding:1px 6px;border-radius:10px}
.tl-voie{background:#fff;color:#000;font-family:"JetBrains Mono",monospace;font-size:.62rem;font-weight:900;padding:1px 6px;border-radius:4px}

/* BOARD */
.board-wrap{padding:20px}
.board-title{font-family:"Bebas Neue",sans-serif;font-size:1.1rem;letter-spacing:.15em;color:var(--accent);margin-bottom:12px}
.btable{width:100%;border-collapse:collapse}
.btable th{font-size:.58rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.4);padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)}
.btable td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.82rem;vertical-align:middle}
.btable tr:hover td{background:rgba(255,255,255,.03);cursor:pointer}
.bt-time{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:1rem}
.bt-delay{font-family:"JetBrains Mono",monospace;font-size:.72rem;color:var(--late)}
.bt-dest{font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-voie{font-family:"JetBrains Mono",monospace;font-weight:900;font-size:1rem;color:var(--accent)}
.st-ok{color:var(--green);font-size:.68rem;font-weight:700}
.st-late{color:var(--late);font-size:.68rem;font-weight:700}
.st-cancel{color:var(--crit);font-size:.68rem;font-weight:700}

/* DISRUPTIONS */
.disrup-wrap{padding:20px}
.dcard{background:rgba(255,255,255,.03);border:1px solid var(--border);border-left:3px solid var(--late);border-radius:10px;padding:13px 15px;margin-bottom:8px;animation:fadeUp .2s ease both}
.dcard.sev{border-left-color:var(--crit)}
.dcard-title{font-weight:700;font-size:.86rem;margin-bottom:3px}
.dcard-msg{font-size:.76rem;color:rgba(255,255,255,.55);line-height:1.5;margin-top:6px}
.eff{display:inline-block;font-size:.6rem;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:5px}
.eff-stop{background:rgba(248,113,113,.1);color:var(--crit);border:1px solid rgba(248,113,113,.2)}
.eff-delay{background:rgba(251,146,60,.1);color:var(--late);border:1px solid rgba(251,146,60,.2)}

/* SCHEDULES */
.sched-wrap{padding:20px}
.sched-line{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;animation:fadeUp .2s ease both}
.sched-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sched-times{display:flex;gap:6px;flex-wrap:wrap}
.sched-chip{background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-family:"JetBrains Mono",monospace;font-size:.8rem}
.sched-chip.rt{border-color:rgba(16,185,129,.3);color:var(--green)}
.sched-chip.late{border-color:rgba(251,146,60,.3);color:var(--late)}

/* LIGNES */
.lines-wrap{padding:20px}
.lcard{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:7px;animation:fadeUp .2s ease both}
.lcard-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.lcard-routes{font-size:.72rem;color:rgba(255,255,255,.4)}

/* ITINERAIRE */
.journey-wrap{padding:20px}
.jfields{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-end}
.jfield{flex:1;min-width:130px}
.jfield label{font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);display:block;margin-bottom:4px}
.jfield input{width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:#fff;font-size:.83rem;font-family:"DM Sans",sans-serif;outline:none}
.jfield input:focus{border-color:var(--accent)}
.jfield input::placeholder{color:rgba(255,255,255,.3)}
.jbtn{background:var(--accent);color:#000;border:none;border-radius:8px;padding:8px 16px;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap}
.jcard{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;animation:fadeUp .2s ease both}
.jcard-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.jcard-time{font-family:"JetBrains Mono",monospace;font-size:1rem;font-weight:700}
.jcard-dur{font-size:.72rem;color:var(--accent);font-weight:700;background:rgba(56,189,248,.08);padding:2px 8px;border-radius:20px;border:1px solid rgba(56,189,248,.2)}
.jcard-secs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.jsec{padding:3px 8px;border-radius:5px;font-size:.68rem;font-weight:700;border:1px solid}
.jsec-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:.76rem}
.jsec-t{font-family:"JetBrains Mono",monospace;color:var(--accent);min-width:42px;flex-shrink:0}

/* SYSTEM */
.si-wrap{padding:20px}
.si-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.si-card{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.si-label{font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.4);margin-bottom:4px}
.si-val{font-family:"JetBrains Mono",monospace;font-size:1.3rem;font-weight:700;color:var(--accent)}
.si-sub{font-size:.62rem;color:rgba(255,255,255,.35);margin-top:2px}
.si-card.ok .si-val{color:var(--green)}.si-card.warn .si-val{color:var(--late)}

/* UTILS */
.center{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:rgba(255,255,255,.3);text-align:center;padding:40px}
.ico{font-size:2.5rem;opacity:.3}.lbl{font-size:.88rem}.sub{font-size:.72rem;color:rgba(255,255,255,.15)}
.spin{width:26px;height:26px;border:3px solid rgba(255,255,255,.1);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
.refresh-bar{height:2px;background:rgba(255,255,255,.05);flex-shrink:0;position:relative}
.refresh-prog{position:absolute;left:0;top:0;bottom:0;background:var(--accent);transition:width .9s linear}

@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>

<div class="topbar">
  <div class="brand">🚄 SNCF OPS</div>
  <div class="clock" id="clock">--:--:--</div>
  <div class="live"><div class="live-dot"></div>LIVE</div>
  <div class="search-wrap">
    <input class="search-input" id="search" type="text" placeholder="Rechercher une gare…" autocomplete="off" spellcheck="false">
    <div class="sugg" id="sugg"></div>
  </div>
  <div class="tabs">
    <div class="tab active" onclick="setTab('train',this)">Trajet</div>
    <div class="tab" onclick="setTab('board',this)">Tableau</div>
    <div class="tab" onclick="setTab('schedules',this)">Horaires</div>
    <div class="tab" onclick="setTab('arrivals',this)">Arrivées</div>
    <div class="tab" onclick="setTab('journey',this)">Itinéraire</div>
    <div class="tab" onclick="setTab('lines',this)">Lignes</div>
    <div class="tab" onclick="setTab('disruptions',this)">Alertes <span id="dcnt" style="display:none;background:#f87171;color:#000;border-radius:10px;padding:1px 5px;font-size:.58rem;margin-left:3px">0</span></div>
  </div>
</div>
<div class="refresh-bar"><div class="refresh-prog" id="rprog"></div></div>

<div class="workspace">
  <div class="sidebar">
    <div class="sidebar-head">
      <div class="gare-label" id="gare-label">Aucune gare sélectionnée</div>
      <div class="kpis" id="kpis" style="display:none">
        <div class="kpi ok"><div class="kpi-n" id="k-ok">0</div><div class="kpi-l">OK</div></div>
        <div class="kpi warn"><div class="kpi-n" id="k-late">0</div><div class="kpi-l">Retard</div></div>
        <div class="kpi danger"><div class="kpi-n" id="k-cancel">0</div><div class="kpi-l">Suppr.</div></div>
        <div class="kpi info"><div class="kpi-n" id="k-total">0</div><div class="kpi-l">Total</div></div>
      </div>
    </div>
    <div class="train-list" id="train-list">
      <div class="center"><div class="ico">🔍</div><div class="lbl">Recherchez une gare</div><div class="sub">Ex: Bordeaux, Lyon, Montparnasse…</div></div>
    </div>
  </div>

  <div class="detail">
    <div class="vtabs">
      <div class="vtab active" data-v="train" onclick="vswitch(this)">📍 Trajet</div>
      <div class="vtab" data-v="board" onclick="vswitch(this)">📋 Départs</div>
      <div class="vtab" data-v="schedules" onclick="vswitch(this)">🕐 Horaires</div>
      <div class="vtab" data-v="arrivals" onclick="vswitch(this)">🚉 Arrivées</div>
      <div class="vtab" data-v="journey" onclick="vswitch(this)">🧭 Itinéraire</div>
      <div class="vtab" data-v="lines" onclick="vswitch(this)">🗺 Lignes</div>
      <div class="vtab" data-v="disruptions" onclick="vswitch(this)">⚠️ Alertes</div>
    </div>

    <div class="view active" id="view-train"><div class="center"><div class="ico">🚄</div><div class="lbl">Cliquez sur un train</div></div></div>
    <div class="view" id="view-board"><div class="center"><div class="ico">📋</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-schedules"><div class="center"><div class="ico">🕐</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-arrivals"><div class="center"><div class="ico">🚉</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-journey">
      <div class="journey-wrap">
        <div class="board-title">🧭 CALCULATEUR D'ITINÉRAIRE</div>
        <div class="jfields">
          <div class="jfield"><label>Départ</label><input id="j-from" placeholder="stop_area:SNCF:87…"></div>
          <div class="jfield"><label>Arrivée</label><input id="j-to" placeholder="stop_area:SNCF:87…"></div>
          <button class="jbtn" onclick="calcJourney()">Calculer →</button>
        </div>
        <div id="jresult"></div>
      </div>
    </div>
    <div class="view" id="view-lines"><div class="center"><div class="ico">🗺</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-disruptions"><div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div></div>
  </div>
</div>

<script>
var G = { stop: null, deps: [], rl: 30, rm: 30 };

// Horloge
function tick() {
  var n = new Date();
  document.getElementById("clock").textContent =
    String(n.getHours()).padStart(2,"0") + ":" +
    String(n.getMinutes()).padStart(2,"0") + ":" +
    String(n.getSeconds()).padStart(2,"0");
}
tick();
setInterval(tick, 1000);

// Refresh bar
setInterval(function() {
  G.rl--;
  document.getElementById("rprog").style.width = (((G.rm - G.rl) / G.rm) * 100) + "%";
  if (G.rl <= 0) { if (G.stop) loadDeps(G.stop.id, G.stop.name, false); G.rl = G.rm; }
}, 1000);

// Utils
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function fmtT(s) { if (!s || s.length < 13) return "--:--"; return s.slice(9,11) + ":" + s.slice(11,13); }
function fmtST(s) { if (!s || s.length < 4) return "--:--"; var h = parseInt(s.slice(0,2)); return String(h >= 24 ? h-24 : h).padStart(2,"0") + ":" + s.slice(2,4); }
function dur(s) { var h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? h+"h"+String(m).padStart(2,"0") : m+"min"; }
function getDelay(dep) {
  var b = dep && dep.stop_date_time && dep.stop_date_time.base_departure_date_time;
  var a = dep && dep.stop_date_time && dep.stop_date_time.departure_date_time;
  if (!b || !a || b === a) return 0;
  return (parseInt(a.slice(9,11))*60 + parseInt(a.slice(11,13))) - (parseInt(b.slice(9,11))*60 + parseInt(b.slice(11,13)));
}
function delayST(b, a) {
  if (!b || !a || b === a) return 0;
  var d = (parseInt(a.slice(0,2))*60 + parseInt(a.slice(2,4))) - (parseInt(b.slice(0,2))*60 + parseInt(b.slice(2,4)));
  return d < -60 ? d + 1440 : d;
}
function lcolor(info) {
  if (info && info.color) return "#" + info.color;
  var m = (info && info.commercial_mode || "").toLowerCase();
  if (m.includes("tgv")) return "#c0092a";
  if (m.includes("ter") || m.includes("lio")) return "#e6007e";
  if (m.includes("intercit")) return "#0088ce";
  return "#38bdf8";
}
function getMat(h, m) {
  var n = parseInt(h);
  if (n>=4600&&n<=4800) return "Corail BB26000";
  if (n>=870000&&n<=879999) return "Régiolis AGC";
  if (n>=9500&&n<=9800) return "TGV Duplex";
  if (m && m.toLowerCase().includes("ter")) return "ZGC / X73500";
  return null;
}
function isCanc(dep) { return (dep.disruptions||[]).some(function(x){ return x.severity && x.severity.effect === "NO_SERVICE"; }); }

// Tabs
function vswitch(el) {
  document.querySelectorAll(".vtab").forEach(function(t){ t.classList.remove("active"); });
  document.querySelectorAll(".view").forEach(function(v){ v.classList.remove("active"); });
  el.classList.add("active");
  document.getElementById("view-" + el.dataset.v).classList.add("active");
  if (el.dataset.v === "arrivals" && G.stop) loadArrivals(G.stop.id);
  if (el.dataset.v === "disruptions") loadDisruptions();
  if (el.dataset.v === "schedules" && G.stop) loadSchedules(G.stop.id);
  if (el.dataset.v === "lines" && G.stop) loadLines(G.stop.id);
}
function setTab(v, el) {
  var t = document.querySelector(".vtab[data-v='" + v + "']");
  if (t) vswitch(t);
  document.querySelectorAll(".tab").forEach(function(t){ t.classList.remove("active"); });
  if (el) el.classList.add("active");
}

// ── RECHERCHE ── (même logique que le fichier Gemini qui marchait)
var stimer = null;
document.getElementById("search").oninput = function() {
  clearTimeout(stimer);
  var q = this.value.trim();
  if (q.length < 3) { hideSugg(); return; }
  stimer = setTimeout(function() { doSearch(q); }, 400);
};
document.addEventListener("click", function(e) { if (!e.target.closest(".search-wrap")) hideSugg(); });
function hideSugg() { document.getElementById("sugg").classList.remove("on"); }

function doSearch(q) {
  fetch("/api/places?q=" + encodeURIComponent(q))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var places = (data.places || []).filter(function(p) { return p.embedded_type.includes("stop"); });
      if (!places.length) { hideSugg(); return; }
      document.getElementById("sugg").innerHTML = places.map(function(p) {
        return '<div class="sug" onclick="selectGare(\'' + esc(p.id) + '\',\'' + esc(p.name).replace(/'/g,"\\'") + '\')">'
          + '<span style="color:var(--accent)">📍</span>'
          + '<span class="sug-name">' + esc(p.name) + '</span>'
          + (p.administrative_regions && p.administrative_regions[0] ? '<span class="sug-region">' + esc(p.administrative_regions[0].name) + '</span>' : '')
          + '</div>';
      }).join("");
      document.getElementById("sugg").classList.add("on");
    })
    .catch(function() { hideSugg(); });
}

function selectGare(id, name) {
  document.getElementById("search").value = name;
  hideSugg();
  loadDeps(id, name, true);
}

// ── DÉPARTS ──
function loadDeps(stopId, name, showLoad) {
  G.stop = { id: stopId, name: name }; G.rl = G.rm;
  if (showLoad) {
    document.getElementById("train-list").innerHTML = '<div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
    document.getElementById("kpis").style.display = "none";
  }
  fetch("/api/departures?stop=" + encodeURIComponent(stopId))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) throw new Error(d.error);
      G.deps = d.departures || [];
      renderDeps(G.deps, name);
      renderBoard(G.deps, name);
    })
    .catch(function(e) {
      document.getElementById("train-list").innerHTML = '<div class="center"><div class="ico">⚠️</div><div class="lbl">' + esc(e.message) + '</div></div>';
    });
}

function renderDeps(deps, name) {
  document.getElementById("gare-label").textContent = "📍 " + name;
  var nOk=0, nL=0, nC=0;
  deps.forEach(function(d) { var c=isCanc(d); if(c) nC++; else if(getDelay(d)>0) nL++; else nOk++; });
  document.getElementById("k-ok").textContent = nOk;
  document.getElementById("k-late").textContent = nL;
  document.getElementById("k-cancel").textContent = nC;
  document.getElementById("k-total").textContent = deps.length;
  document.getElementById("kpis").style.display = "flex";

  if (!deps.length) { document.getElementById("train-list").innerHTML = '<div class="center"><div class="ico">🚉</div><div class="lbl">Aucun départ</div></div>'; return; }

  document.getElementById("train-list").innerHTML = deps.map(function(dep, i) {
    var info = dep.display_informations || {};
    var dt = dep.stop_date_time || {};
    var delay = getDelay(dep), canc = isCanc(dep);
    var cause = (dep.disruptions && dep.disruptions[0] && dep.disruptions[0].cause) || "";
    var plat = dt.platform_code || null;
    var col = lcolor(info), mat = getMat(info.headsign, info.commercial_mode);
    var vjId = ((dep.links||[]).find(function(l){ return l.type==="vehicle_journey"; }) || {}).id || "";
    var cls = "card" + (canc?" cancelled":delay>=15?" verylate":delay>0?" late":"");
    var dc = canc?"var(--crit)":delay>0?"var(--late)":"var(--text)";
    var badges = "";
    if (!canc && delay===0) badges += '<span class="badge b-ok">✓ A l&#39;heure</span>';
    if (!canc && delay>0) badges += '<span class="badge b-late">+' + delay + 'min</span>';
    if (canc) badges += '<span class="badge b-cancel">Supprimé</span>';
    if (cause) badges += '<span class="b-cause">⚠ ' + esc(cause) + '</span>';

    return '<div class="' + cls + '" style="border-left-color:' + col + ';animation-delay:' + (i*25) + 'ms"'
      + ' onclick="openTrain(\'' + esc(vjId) + '\',\'' + esc(info.headsign||"") + '\',\'' + esc(info.commercial_mode||"") + '\',\'' + esc(info.direction||"") + '\',\'' + esc(col) + '\')">'
      + '<div class="card-top"><div class="card-left">'
      + '<div style="margin-bottom:3px"><span class="mode-chip" style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '35">' + esc(info.commercial_mode||"TRAIN") + '</span>'
      + '<span class="train-num">' + esc(info.headsign||"—") + '</span></div>'
      + '<div class="train-dir">→ ' + esc((info.direction||"—").split("(")[0].trim()) + '</div>'
      + '<div class="badges">' + badges + (mat?'<span style="color:rgba(255,255,255,.25);font-size:.56rem;font-style:italic">· '+esc(mat)+'</span>':"") + '</div>'
      + '</div><div class="card-right">'
      + '<div class="dep-time" style="color:' + dc + '">' + (canc?"SUPP":fmtT(dt.departure_date_time)) + '</div>'
      + (delay>0&&!canc?'<div class="dep-base">' + fmtT(dt.base_departure_date_time) + '</div>':"")
      + (plat?'<div class="voie-badge">Voie ' + esc(plat) + '</div>':"")
      + '</div></div></div>';
  }).join("");
}

function openTrain(vjId, hs, mode, dir, col) {
  document.querySelectorAll(".card").forEach(function(c){ c.classList.remove("sel"); });
  event.currentTarget.classList.add("sel");
  setTab("train", null);
  showTrain(vjId, hs, mode, dir, col);
}

// ── BOARD ──
function renderBoard(deps, name) {
  if (!deps.length) { document.getElementById("view-board").innerHTML = '<div class="center"><div class="ico">📋</div><div class="lbl">Aucun départ</div></div>'; return; }
  var rows = deps.map(function(dep) {
    var info = dep.display_informations||{}, dt = dep.stop_date_time||{};
    var delay = getDelay(dep), canc = isCanc(dep), col = lcolor(info);
    var vjId = ((dep.links||[]).find(function(l){ return l.type==="vehicle_journey"; })||{}).id||"";
    return '<tr onclick="setTab(\'train\',null);showTrain(\'' + esc(vjId) + '\',\'' + esc(info.headsign||"") + '\',\'' + esc(info.commercial_mode||"") + '\',\'' + esc(info.direction||"") + '\',\'' + esc(col) + '\')">'
      + '<td><span class="bt-time" style="color:' + (canc?"var(--crit)":delay>0?"var(--late)":"") + '">' + fmtT(dt.departure_date_time) + '</span>'
      + (delay>0&&!canc?'<div class="bt-delay">' + fmtT(dt.base_departure_date_time) + '</div>':"") + '</td>'
      + '<td><span class="mode-chip" style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '35">' + esc(info.commercial_mode||"?") + '</span> '
      + '<span style="font-family:JetBrains Mono,monospace;font-size:.78rem">' + esc(info.headsign||"") + '</span></td>'
      + '<td class="bt-dest">' + esc((info.direction||"—").split("(")[0].trim()) + '</td>'
      + '<td class="bt-voie">' + (dt.platform_code||"—") + '</td>'
      + '<td>' + (canc?'<span class="st-cancel">SUPPRIMÉ</span>':delay>0?'<span class="st-late">+'+delay+'min</span>':'<span class="st-ok">OK</span>') + '</td>'
      + '</tr>';
  }).join("");
  document.getElementById("view-board").innerHTML = '<div class="board-wrap"><div class="board-title">📋 DÉPARTS — ' + esc(name) + '</div>'
    + '<table class="btable"><thead><tr><th>HEURE</th><th>TRAIN</th><th>DESTINATION</th><th>VOIE</th><th>ÉTAT</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── HORAIRES ──
function loadSchedules(stopId) {
  document.getElementById("view-schedules").innerHTML = '<div class="center"><div class="spin"></div></div>';
  fetch("/api/schedules?stop=" + encodeURIComponent(stopId))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var sc = d.stop_schedules || [];
      if (!sc.length) { document.getElementById("view-schedules").innerHTML = '<div class="center"><div class="ico">🕐</div><div class="lbl">Aucun horaire</div></div>'; return; }
      var html = '<div class="sched-wrap"><div class="board-title">🕐 HORAIRES — ' + esc(G.stop&&G.stop.name||"") + '</div>';
      sc.forEach(function(s, i) {
        var route=s.route||{}, line=route.line||{}, col=line.color?"#"+line.color:"var(--accent)";
        var times = (s.date_times||[]).map(function(dt) {
          var rt = dt.data_freshness==="realtime";
          var delay = dt.base_date_time&&dt.date_time&&dt.base_date_time!==dt.date_time ? delayST(dt.base_date_time.slice(9),dt.date_time.slice(9)) : 0;
          return '<span class="sched-chip' + (rt&&delay>0?" late":rt?" rt":"") + '">' + fmtT(dt.date_time||dt.base_date_time) + (delay>0?' +'+delay:"") + '</span>';
        }).join("");
        html += '<div class="sched-line" style="animation-delay:' + (i*25) + 'ms">'
          + '<div class="sched-head"><span class="mode-chip" style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '35">' + esc(line.commercial_mode&&line.commercial_mode.name||"LIGNE") + '</span>'
          + '<span style="font-weight:700">' + esc(line.code||line.name||"") + '</span>'
          + '<span style="color:rgba(255,255,255,.4);font-size:.72rem;flex:1;margin-left:6px">→ ' + esc(route.direction&&route.direction.stop_area&&route.direction.stop_area.name||"") + '</span></div>'
          + (times?'<div class="sched-times">'+times+'</div>':'<div style="color:rgba(255,255,255,.3);font-size:.72rem">Pas de départ imminent</div>')
          + '</div>';
      });
      document.getElementById("view-schedules").innerHTML = html + '</div>';
    })
    .catch(function(e){ document.getElementById("view-schedules").innerHTML = '<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>'; });
}

// ── ARRIVÉES ──
function loadArrivals(stopId) {
  document.getElementById("view-arrivals").innerHTML = '<div class="center"><div class="spin"></div></div>';
  fetch("/api/arrivals?stop=" + encodeURIComponent(stopId))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var arrs = d.arrivals || [];
      if (!arrs.length) { document.getElementById("view-arrivals").innerHTML = '<div class="center"><div class="ico">🚉</div><div class="lbl">Aucune arrivée</div></div>'; return; }
      var rows = arrs.map(function(arr) {
        var info=arr.display_informations||{}, dt=arr.stop_date_time||{};
        var bA=dt.base_arrival_date_time, rA=dt.arrival_date_time;
        var delay = bA&&rA&&bA!==rA ? (parseInt(rA.slice(9,11))*60+parseInt(rA.slice(11,13)))-(parseInt(bA.slice(9,11))*60+parseInt(bA.slice(11,13))) : 0;
        var col=lcolor(info), canc=isCanc(arr);
        return '<tr><td><span class="bt-time" style="color:' + (canc?"var(--crit)":delay>0?"var(--late)":"") + '">' + fmtT(rA) + '</span>'
          + (delay>0?'<div class="bt-delay">'+fmtT(bA)+'</div>':"") + '</td>'
          + '<td><span class="mode-chip" style="background:'+col+'20;color:'+col+';border:1px solid '+col+'35">'+esc(info.commercial_mode||"?")+' </span>'
          + '<span style="font-family:JetBrains Mono,monospace;font-size:.78rem">'+esc(info.headsign||"")+'</span></td>'
          + '<td class="bt-dest" style="color:rgba(255,255,255,.5)">De '+esc((info.direction||"—").split("(")[0].trim())+'</td>'
          + '<td class="bt-voie">'+(dt.platform_code||"—")+'</td>'
          + '<td>'+(canc?'<span class="st-cancel">SUPPRIMÉ</span>':delay>0?'<span class="st-late">+'+delay+'min</span>':'<span class="st-ok">OK</span>')+'</td>'
          + '</tr>';
      }).join("");
      document.getElementById("view-arrivals").innerHTML = '<div class="board-wrap"><div class="board-title">🚉 ARRIVÉES — '+esc(G.stop&&G.stop.name||"")+'</div>'
        + '<table class="btable"><thead><tr><th>HEURE</th><th>TRAIN</th><th>PROVENANCE</th><th>VOIE</th><th>ÉTAT</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    })
    .catch(function(e){ document.getElementById("view-arrivals").innerHTML = '<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>'; });
}

// ── PERTURBATIONS ──
function loadDisruptions() {
  document.getElementById("view-disruptions").innerHTML = '<div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
  fetch("/api/disruptions")
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var list = d.disruptions || [];
      var cnt = document.getElementById("dcnt");
      cnt.textContent = list.length; cnt.style.display = list.length ? "" : "none";
      if (!list.length) { document.getElementById("view-disruptions").innerHTML = '<div class="center"><div class="ico">✅</div><div class="lbl">Aucune perturbation</div><div class="sub">Réseau nominal</div></div>'; return; }
      var html = '<div class="disrup-wrap"><div class="board-title">⚠️ PERTURBATIONS ('+list.length+')</div>';
      list.forEach(function(d, i) {
        var eff = d.severity&&d.severity.effect||"";
        var cause = d.cause||"";
        var msg = "";
        var msgs = d.messages||[];
        for (var mi=0; mi<msgs.length; mi++) { if (msgs[mi]&&(msgs[mi].text||msgs[mi].value)){msg=msgs[mi].text||msgs[mi].value;break;} }
        var isSev = eff==="NO_SERVICE"||eff==="SIGNIFICANT_DELAYS";
        var effLbl = eff==="NO_SERVICE"?"TRAFIC INTERROMPU":eff==="SIGNIFICANT_DELAYS"?"RETARDS IMPORTANTS":eff==="REDUCED_SERVICE"?"SERVICE RÉDUIT":"INFO";
        var lines = (d.impacted_objects||[]).slice(0,3).map(function(o){ return o.pt_object&&o.pt_object.name||""; }).filter(Boolean).join(", ");
        html += '<div class="dcard' + (isSev?" sev":"") + '" style="animation-delay:'+(i*25)+'ms">'
          + '<div class="dcard-title">'+esc(cause||(msg&&msg.slice(0,70))||"Perturbation réseau")+'</div>'
          + (lines?'<div style="font-size:.68rem;color:rgba(255,255,255,.4);margin-top:2px">🚆 '+esc(lines)+'</div>':"")
          + (msg?'<div class="dcard-msg">'+esc(msg)+'</div>':"")
          + '<span class="eff '+(isSev?"eff-stop":"eff-delay")+'">'+effLbl+'</span></div>';
      });
      document.getElementById("view-disruptions").innerHTML = html + '</div>';
    })
    .catch(function(e){ document.getElementById("view-disruptions").innerHTML = '<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>'; });
}

// ── LIGNES ──
function loadLines(stopId) {
  document.getElementById("view-lines").innerHTML = '<div class="center"><div class="spin"></div></div>';
  fetch("/api/lines?stop=" + encodeURIComponent(stopId))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var lines = d.lines||[];
      if (!lines.length) { document.getElementById("view-lines").innerHTML = '<div class="center"><div class="ico">🗺</div><div class="lbl">Aucune ligne</div></div>'; return; }
      var html = '<div class="lines-wrap"><div class="board-title">🗺 LIGNES — '+esc(G.stop&&G.stop.name||"")+'</div>';
      lines.forEach(function(l, i) {
        var col=l.color?"#"+l.color:"var(--accent)";
        var routes=(l.routes||[]).slice(0,3).map(function(ro){ return ro.direction&&ro.direction.stop_area&&ro.direction.stop_area.name||ro.name||""; }).filter(Boolean).join(" · ");
        html += '<div class="lcard" style="animation-delay:'+(i*20)+'ms">'
          + '<div class="lcard-head"><span class="mode-chip" style="background:'+col+'20;color:'+col+';border:1px solid '+col+'35">'+esc(l.commercial_mode&&l.commercial_mode.name||"LIGNE")+'</span>'
          + '<span style="font-weight:700;font-size:.9rem">'+esc(l.code||l.name||"")+'</span>'
          + '<span style="color:rgba(255,255,255,.4);font-size:.72rem;margin-left:6px">'+esc(l.name||"")+'</span>'
          + (l.opening_time&&l.closing_time?'<span style="font-family:JetBrains Mono,monospace;font-size:.62rem;color:rgba(255,255,255,.35);margin-left:auto">'+l.opening_time.slice(0,2)+":"+l.opening_time.slice(2,4)+" – "+l.closing_time.slice(0,2)+":"+l.closing_time.slice(2,4)+'</span>':"")
          + '</div>'
          + (routes?'<div class="lcard-routes">↔ '+esc(routes)+'</div>':"")
          + '</div>';
      });
      document.getElementById("view-lines").innerHTML = html + '</div>';
    })
    .catch(function(e){ document.getElementById("view-lines").innerHTML = '<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>'; });
}

// ── ITINÉRAIRE ──
function calcJourney() {
  var from=document.getElementById("j-from").value.trim(), to=document.getElementById("j-to").value.trim();
  if (!from||!to) { document.getElementById("jresult").innerHTML='<div style="color:var(--late);padding:10px;font-size:.82rem">Renseignez les deux champs.</div>'; return; }
  document.getElementById("jresult").innerHTML='<div class="center"><div class="spin"></div></div>';
  fetch("/api/journeys?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var journeys=d.journeys||[];
      if (!journeys.length) { document.getElementById("jresult").innerHTML='<div style="color:rgba(255,255,255,.4);padding:20px;font-size:.82rem">Aucun itinéraire. Utilisez des IDs stop_area (ex: stop_area:SNCF:87...).</div>'; return; }
      document.getElementById("jresult").innerHTML=journeys.map(function(j,i) {
        var dep=j.departure_date_time, arr=j.arrival_date_time;
        var dH=dep?dep.slice(9,11)+":"+dep.slice(11,13):"?", aH=arr?arr.slice(9,11)+":"+arr.slice(11,13):"?";
        var secs=j.sections||[];
        var chips=secs.map(function(s) {
          if (s.type==="waiting") return '<span class="jsec" style="background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);border-color:var(--border)">⏳ '+Math.round((s.duration||0)/60)+'min</span>';
          if (s.type==="street_network"||s.type==="crow_fly") return '<span class="jsec" style="background:rgba(56,189,248,.06);color:var(--accent);border-color:rgba(56,189,248,.2)">🚶 '+Math.round((s.duration||0)/60)+'min</span>';
          if (s.type==="public_transport") { var info=s.display_informations||{},col=lcolor(info); return '<span class="jsec" style="background:'+col+'15;color:'+col+';border-color:'+col+'30">'+esc(info.commercial_mode||"🚄")+" "+esc(info.headsign||"")+'</span>'; }
          return "";
        }).filter(Boolean).join("");
        var detail=secs.map(function(s) {
          if (s.type==="waiting") return '<div class="jsec-row"><span class="jsec-t"></span><span>⏳</span><span style="color:rgba(255,255,255,.4)">Correspondance '+Math.round((s.duration||0)/60)+'min</span></div>';
          if (s.type==="street_network"||s.type==="crow_fly") return '<div class="jsec-row"><span class="jsec-t">'+(s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"")+'</span><span>🚶</span><span>A pied · '+Math.round((s.duration||0)/60)+'min</span></div>';
          if (s.type==="public_transport") {
            var info=s.display_informations||{},col=lcolor(info);
            var f2=s.from&&(s.from.stop_point&&s.from.stop_point.name||s.from.name)||"";
            var t2=s.to&&(s.to.stop_point&&s.to.stop_point.name||s.to.name)||"";
            var dT2=s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"";
            return '<div class="jsec-row"><span class="jsec-t">'+dT2+'</span><span>🚄</span><span><strong style="color:'+col+'">'+esc(info.commercial_mode||"")+" "+esc(info.headsign||"")+'</strong> '+esc(f2)+' → <strong>'+esc(t2)+'</strong></span></div>';
          }
          return "";
        }).filter(Boolean).join("");
        return '<div class="jcard" style="animation-delay:'+(i*50)+'ms">'
          +'<div class="jcard-head"><div><div class="jcard-time">'+dH+' → '+aH+'</div>'
          +'<div style="font-size:.7rem;color:rgba(255,255,255,.4);margin-top:2px">'+(j.nb_transfers||0)+' correspondance'+(j.nb_transfers!==1?"s":"")+'</div></div>'
          +'<div class="jcard-dur">'+dur(j.duration||0)+'</div></div>'
          +'<div class="jcard-secs">'+chips+'</div>'
          +'<div>'+detail+'</div></div>';
      }).join("");
    })
    .catch(function(e){ document.getElementById("jresult").innerHTML='<div style="color:var(--crit);padding:12px;font-size:.82rem">⚠️ '+esc(e.message)+'</div>'; });
}

// ── TRAJET DÉTAILLÉ ──
function showTrain(vjId, hs, mode, dir, col) {
  document.getElementById("view-train").innerHTML = '<div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
  if (!vjId) { document.getElementById("view-train").innerHTML = '<div class="center"><div class="ico">⚠️</div><div class="lbl">ID introuvable</div></div>'; return; }
  fetch("/api/vehicle?id=" + encodeURIComponent(vjId))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      var vj=d.vehicle_journeys&&d.vehicle_journeys[0];
      if (!vj) throw new Error("Trajet introuvable");
      var disrup=d.disruptions&&d.disruptions[0];
      var impacted=(disrup&&disrup.impacted_objects&&disrup.impacted_objects[0]&&disrup.impacted_objects[0].impacted_stops)||[];
      var msg=""; var msgs=disrup&&disrup.messages||[];
      for (var mi=0;mi<msgs.length;mi++){if(msgs[mi]&&(msgs[mi].text||msgs[mi].value)){msg=msgs[mi].text||msgs[mi].value;break;}}
      if (!msg&&disrup) msg=disrup.cause||"";
      var mat=getMat(hs,mode), stops=vj.stop_times||[];

      var delayData=stops.map(function(st){
        var imp=impacted.find(function(x){return x.stop_point&&x.stop_point.id===st.stop_point.id;});
        var bT=imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
        var aT=imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
        return {name:st.stop_point&&st.stop_point.name||"?", delay:delayST(bT,aT)};
      });
      var maxDelay=delayData.reduce(function(m,d){return Math.max(m,d.delay);},0);

      var html='<div class="train-hero" data-num="'+esc(hs)+'">'
        +'<div class="hero-num" style="color:'+col+'">'+esc(hs)+'</div>'
        +'<div class="hero-dir">→ '+esc((dir||"").split("(")[0].trim())+'</div>'
        +'<div class="hero-badges">'
        +'<span class="hbadge" style="background:'+col+'15;color:'+col+';border-color:'+col+'30">'+esc(mode)+'</span>'
        +(mat?'<span class="hbadge" style="background:rgba(255,255,255,.04);color:rgba(255,255,255,.6);border-color:var(--border)">'+esc(mat)+'</span>':"")
        +'<span class="hbadge" style="background:rgba(255,255,255,.04);color:rgba(255,255,255,.4);border-color:var(--border)">'+stops.length+' arrêts</span>'
        +(maxDelay>0?'<span class="hbadge" style="background:rgba(251,146,60,.08);color:var(--late);border-color:rgba(251,146,60,.2)">+'+maxDelay+'min max</span>':"")
        +'</div></div>';

      html+='<div class="alert-box'+(msg?" on":"")+'"><strong>⚡ PERTURBATION</strong>'+esc(msg)+'</div>';

      if (maxDelay>0) {
        var bars=delayData.map(function(d){
          var pct=maxDelay>0?Math.round((d.delay/maxDelay)*100):0;
          var bc=d.delay>=15?"var(--crit)":d.delay>0?"var(--late)":"rgba(255,255,255,.08)";
          return '<div class="cbar-wrap"><div class="cbar" style="height:'+pct+'%;background:'+bc+'" title="'+esc(d.name)+' +'+d.delay+'min"></div><div class="cbar-lbl">'+esc(d.name.split(" ")[0])+'</div></div>';
        }).join("");
        html+='<div class="chart-wrap on"><div class="chart-title">📊 RETARD PAR ARRÊT</div><div class="chart-bars">'+bars+'</div></div>';
      }

      var prevDelay=0, delayStarted=false;
      html+='<div class="timeline">';
      stops.forEach(function(st, i) {
        var isFirst=i===0, isLast=i===stops.length-1;
        var imp=impacted.find(function(x){return x.stop_point&&x.stop_point.id===st.stop_point.id;});
        var bT=imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
        var aT=imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
        var delay=delayST(bT,aT), plat=(st.stop_point&&st.stop_point.platform_code)||(imp&&imp.stop_point&&imp.stop_point.platform_code)||null;
        var isImp=delay>0, isOrigin=isImp&&!delayStarted, isCatch=isImp&&delay<prevDelay&&prevDelay>0;
        if (isImp) delayStarted=true;
        var dotCls="tl-dot"+(isFirst?" first":isLast?" last":isOrigin?" origin":isImp?" impacted":"");
        html+='<div class="tl-stop" style="animation-delay:'+(i*12)+'ms">'
          +'<div class="tl-col"><div class="'+dotCls+'"></div>'+(!isLast?'<div class="tl-seg'+(isImp?" imp":"")+'"></div>':"")+'</div>'
          +'<div class="tl-content">'
          +(isOrigin?'<div class="tl-incident">⚡ Gare d&#39;incident</div>':"")
          +'<div class="tl-row"><span class="tl-name">'+esc(st.stop_point&&st.stop_point.name||"—")+'</span>'
          +(plat?'<span class="tl-voie">Voie '+esc(plat)+'</span>':"")+'</div>'
          +'<div class="tl-times"><span class="tl-time">'+fmtST(aT)+'</span>'
          +(delay>0?'<span class="tl-base">'+fmtST(bT)+'</span><span class="tl-delay">+'+delay+'min</span>':"")
          +(isCatch?'<span class="tl-catch">-'+(prevDelay-delay)+'min rattrapé</span>':"")
          +'</div></div></div>';
        prevDelay=delay;
      });
      html+="</div>";
      document.getElementById("view-train").innerHTML=html;
    })
    .catch(function(e){ document.getElementById("view-train").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>'; });
}

loadDisruptions();
</script>
</body>
</html>`;
