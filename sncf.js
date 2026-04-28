#!/usr/bin/env node
const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT    = process.env.PORT || 3333;

if (!API_KEY) {
  console.error("❌ Clé API manquante ! Ajoute SNCF_API_KEY dans Render.");
  process.exit(1);
}

// ── Cache ──────────────────────────────────────────────────────
const cache = new Map();
const TTL = { places:300000, departures:20000, arrivals:20000, vehicle:30000, disruptions:60000, schedules:20000, lines:600000, journeys:120000 };
function cget(k){ const e=cache.get(k); if(!e)return null; if(Date.now()-e.t>e.ttl){cache.delete(k);return null;} return e.d; }
function cset(k,d,ttl){ cache.set(k,{d,t:Date.now(),ttl}); }
setInterval(()=>{ const n=Date.now(); for(const[k,v]of cache)if(n-v.t>v.ttl)cache.delete(k); },60000);

const stats = {api:0,cached:0,errors:0,total:0,start:Date.now()};
const pad = n=>String(n).padStart(2,"0");
const log = (e,m)=>console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${e} ${m}`);

function sncfGet(path, ttlKey) {
  const cached = cget(path);
  if (cached) { stats.cached++; return Promise.resolve(cached); }
  stats.api++;
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
        try { const d = JSON.parse(raw); cset(path, d, TTL[ttlKey]||30000); resolve(d); }
        catch(e) { reject(new Error("JSON invalide")); }
      });
    }).on("error", e => { stats.errors++; reject(e); });
  });
}

function nowDT() {
  const n = new Date();
  return n.getFullYear()+pad(n.getMonth()+1)+pad(n.getDate())+"T"+pad(n.getHours())+pad(n.getMinutes())+"00";
}

// ── Serveur ────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const p = url.parse(req.url, true);
  res.setHeader("Access-Control-Allow-Origin","*");
  stats.total++;

  if (p.pathname === "/" || p.pathname === "/index.html") {
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end(HTML); return;
  }

  res.setHeader("Content-Type","application/json");

  try {
    let data;
    const q = p.query;

    if (p.pathname === "/api/places") {
      // NOTE: on n'encode PAS les crochets - l'API SNCF les veut tels quels
      const path = "places?q=" + encodeURIComponent(q.q||"") + "&type[]=stop_area&count=8";
      log("🔍", "Recherche: " + q.q);
      data = await sncfGet(path, "places");
      log("✅", (data.places||[]).length + " résultat(s)");
    }
    else if (p.pathname === "/api/departures") {
      data = await sncfGet("stop_areas/"+encodeURIComponent(q.stop)+"/departures?from_datetime="+nowDT()+"&count=40&data_freshness=realtime&depth=2", "departures");
      log("🚄", (data.departures||[]).length + " départs");
    }
    else if (p.pathname === "/api/arrivals") {
      data = await sncfGet("stop_areas/"+encodeURIComponent(q.stop)+"/arrivals?from_datetime="+nowDT()+"&count=40&data_freshness=realtime&depth=2", "arrivals");
    }
    else if (p.pathname === "/api/vehicle") {
      data = await sncfGet("vehicle_journeys/"+encodeURIComponent(q.id)+"?data_freshness=realtime", "vehicle");
    }
    else if (p.pathname === "/api/disruptions") {
      data = await sncfGet("disruptions?count=100&depth=2", "disruptions");
    }
    else if (p.pathname === "/api/schedules") {
      data = await sncfGet("stop_areas/"+encodeURIComponent(q.stop)+"/stop_schedules?from_datetime="+nowDT()+"&data_freshness=realtime&items_per_schedule=3&depth=2", "schedules");
    }
    else if (p.pathname === "/api/lines") {
      data = await sncfGet("stop_areas/"+encodeURIComponent(q.stop)+"/lines?depth=2", "lines");
    }
    else if (p.pathname === "/api/journeys") {
      data = await sncfGet("journeys?from="+encodeURIComponent(q.from)+"&to="+encodeURIComponent(q.to)+"&datetime="+nowDT()+"&count=3&data_freshness=realtime", "journeys");
    }
    else if (p.pathname === "/api/stats") {
      data = {...stats, uptime:Math.round((Date.now()-stats.start)/1000), cacheSize:cache.size};
    }
    else { res.writeHead(404); res.end(JSON.stringify({error:"Not found"})); return; }

    res.end(JSON.stringify(data));
  } catch(e) {
    stats.errors++;
    log("❌", e.message);
    res.end(JSON.stringify({error: e.message}));
  }
}).listen(PORT, async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚄  SNCF OPS CENTER — http://localhost:"+PORT);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    const d = await sncfGet("places?q=paris&type[]=stop_area&count=1","places");
    console.log(d.places ? "✅ API SNCF OK !" : "⚠️ Réponse inattendue: "+JSON.stringify(d).slice(0,100));
  } catch(e) { console.log("❌ Erreur SNCF: "+e.message); }
});

// ── HTML ───────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNCF OPS CENTER</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#04070e;--panel:#070d18;--card:#0b1422;--card2:#0e1928;--border:#13253d;--border2:#1a3354;--text:#ccd9ee;--muted:#3d5475;--blue:#2f80ed;--blue2:#56a0f5;--cyan:#00c2d4;--green:#00e676;--green2:#1de9b6;--orange:#ff9100;--red:#ff1744}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:"DM Sans",sans-serif;display:flex;flex-direction:column}

.topbar{height:52px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:14px;flex-shrink:0;position:relative;z-index:100;overflow:visible}
.brand{font-family:"Bebas Neue",sans-serif;font-size:1.2rem;letter-spacing:.1em;color:var(--blue2);display:flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0}
.brand span{color:var(--text)}
.clock{font-family:"JetBrains Mono",monospace;font-size:.85rem;color:var(--cyan);white-space:nowrap;flex-shrink:0;min-width:70px}
.live-badge{display:flex;align-items:center;gap:5px;font-size:.62rem;font-weight:700;letter-spacing:.1em;color:var(--green);flex-shrink:0}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:blink 2s ease infinite}

.search-wrap{flex:1;max-width:360px;position:relative;overflow:visible}
.search-input{width:100%;background:var(--card);border:1px solid var(--border2);border-radius:8px;padding:8px 34px 8px 12px;color:var(--text);font-size:.85rem;font-family:"DM Sans",sans-serif;outline:none;transition:border-color .2s}
.search-input:focus{border-color:var(--blue)}
.search-input::placeholder{color:var(--muted)}
.search-icon{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.search-spin{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;border:2px solid var(--border2);border-top-color:var(--blue);border-radius:50%;animation:spin .7s linear infinite;display:none}
.search-spin.on{display:block}

.sugg{position:absolute;top:calc(100% + 6px);left:0;right:0;background:#0a1525;border:1px solid var(--border2);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.9);overflow:hidden;display:none;z-index:99999}
.sugg.on{display:block}
.sug{padding:10px 13px;cursor:pointer;border-bottom:1px solid var(--border);font-size:.84rem;display:flex;align-items:center;gap:8px;transition:background .1s}
.sug:last-child{border-bottom:none}
.sug:hover{background:#112038}
.sug-name{color:var(--text);flex:1}
.sug-region{color:var(--muted);font-size:.68rem}

.api-stats{display:flex;gap:12px;font-size:.62rem;font-family:"JetBrains Mono",monospace;color:var(--muted);flex-shrink:0}
.api-stat-n{color:var(--blue2);font-weight:700}

.top-tabs{display:flex;gap:2px;margin-left:auto;flex-shrink:0;flex-wrap:nowrap}
.ttab{padding:5px 10px;border-radius:6px;font-size:.65rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;color:var(--muted);border:1px solid transparent;white-space:nowrap;transition:all .15s}
.ttab:hover{color:var(--text);background:var(--card)}
.ttab.active{color:var(--blue2);background:rgba(47,128,237,.1);border-color:rgba(47,128,237,.25)}
.ttab .cnt{background:var(--red);color:#fff;border-radius:10px;padding:1px 4px;font-size:.58rem;margin-left:3px;vertical-align:middle}

.workspace{flex:1;display:flex;overflow:hidden}
.refresh-bar{height:2px;background:var(--border);flex-shrink:0;position:relative}
.refresh-prog{position:absolute;left:0;top:0;bottom:0;background:var(--blue);transition:width .9s linear}

.sidebar{width:355px;min-width:355px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sidebar-head{padding:10px 12px 8px;border-bottom:1px solid var(--border);flex-shrink:0}
.sgare{font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.kpis{display:flex;gap:5px}
.kpi{flex:1;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:6px 8px;text-align:center}
.kpi-n{font-family:"JetBrains Mono",monospace;font-size:1.2rem;font-weight:700;line-height:1}
.kpi-l{font-size:.5rem;color:var(--muted);margin-top:1px;text-transform:uppercase;letter-spacing:.06em}
.kpi.ok .kpi-n{color:var(--green)}.kpi.warn .kpi-n{color:var(--orange)}.kpi.danger .kpi-n{color:var(--red)}.kpi.info .kpi-n{color:var(--blue2)}
.tlist{flex:1;overflow-y:auto;padding:8px}
.tlist::-webkit-scrollbar{width:3px}
.tlist::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}

.tcard{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:7px;padding:10px 11px;margin-bottom:5px;cursor:pointer;transition:background .12s,transform .1s;animation:fadeUp .2s ease both}
.tcard:hover{background:var(--card2);transform:translateX(2px)}
.tcard.sel{background:#0f1e35;border-color:var(--blue);box-shadow:0 0 0 1px rgba(47,128,237,.2)}
.tcard.late{border-left-color:var(--orange)}.tcard.verylate{border-left-color:var(--red)}.tcard.cancelled{border-left-color:var(--red);opacity:.55}
.tc-row{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}
.tc-left{flex:1;min-width:0}.tc-right{text-align:right;flex-shrink:0}
.mchip{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:.55rem;font-weight:700;padding:1px 5px;border-radius:3px;letter-spacing:.1em;margin-right:4px;vertical-align:middle}
.tnum{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:.88rem;vertical-align:middle}
.tdir{font-size:.74rem;color:#5a7a9a;margin:2px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brow{display:flex;gap:3px;flex-wrap:wrap;align-items:center}
.b{font-size:.58rem;font-weight:700;padding:1px 5px;border-radius:20px;white-space:nowrap}
.b-ok{background:rgba(0,230,118,.07);color:var(--green);border:1px solid rgba(0,230,118,.18)}
.b-late{background:rgba(255,145,0,.07);color:var(--orange);border:1px solid rgba(255,145,0,.18)}
.b-cancel{background:rgba(255,23,68,.07);color:var(--red);border:1px solid rgba(255,23,68,.18)}
.b-cause{color:var(--muted);font-size:.55rem}
.dtime{font-family:"JetBrains Mono",monospace;font-size:1.45rem;font-weight:700;line-height:1}
.dbase{font-family:"JetBrains Mono",monospace;font-size:.65rem;color:var(--muted);text-decoration:line-through}
.voie{display:inline-block;margin-top:3px;background:#0f2040;color:#5ba3f5;border:1px solid #1a3566;padding:2px 6px;border-radius:4px;font-size:.65rem;font-family:"JetBrains Mono",monospace;font-weight:700}

.detail{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
.vtabs{display:flex;border-bottom:1px solid var(--border);background:var(--panel);padding:0 14px;flex-shrink:0;overflow-x:auto}
.vtabs::-webkit-scrollbar{height:2px}
.vtab{padding:11px 12px;font-size:.67rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;flex-shrink:0}
.vtab:hover{color:var(--text)}.vtab.active{color:var(--blue2);border-bottom-color:var(--blue2)}
.view{display:none;flex:1;overflow-y:auto}
.view.active{display:block}
.view::-webkit-scrollbar{width:4px}
.view::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}

.train-hero{padding:24px 28px 18px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,#07111f,var(--bg));position:relative;overflow:hidden}
.train-hero::before{content:attr(data-num);position:absolute;right:-10px;top:-20px;font-family:"Bebas Neue",sans-serif;font-size:8rem;color:rgba(255,255,255,.02);pointer-events:none;user-select:none}
.hero-num{font-family:"Bebas Neue",sans-serif;font-size:3.5rem;line-height:1;letter-spacing:.02em;margin-bottom:3px}
.hero-dir{font-size:.9rem;color:#6a8aaa;margin-bottom:12px}
.hero-badges{display:flex;gap:6px;flex-wrap:wrap}
.hbadge{padding:3px 10px;border-radius:5px;font-size:.68rem;font-weight:700;border:1px solid}
.alert-box{margin:14px 28px;background:rgba(255,23,68,.06);border:1px solid rgba(255,23,68,.22);border-left:3px solid var(--red);border-radius:8px;padding:11px 14px;font-size:.8rem;color:#ff8a9a;display:none}
.alert-box.on{display:block}
.alert-box strong{color:var(--red);display:block;margin-bottom:3px;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase}
.chart-wrap{margin:12px 28px;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:14px;display:none}
.chart-wrap.on{display:block}
.chart-title{font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px}
.chart-bars{display:flex;align-items:flex-end;gap:2px;height:50px;padding-bottom:14px}
.cbar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;position:relative}
.cbar{width:100%;border-radius:2px 2px 0 0;min-height:2px}
.cbar-lbl{position:absolute;bottom:-13px;font-size:.42rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28px;text-align:center}
.timeline{padding:18px 28px 36px}
.tl-stop{display:flex;gap:12px;animation:fadeUp .18s ease both}
.tl-col{display:flex;flex-direction:column;align-items:center;width:12px;flex-shrink:0;padding-top:5px}
.tl-dot{width:8px;height:8px;border-radius:50%;border:2px solid var(--border2);background:var(--bg);flex-shrink:0}
.tl-dot.first{background:var(--green2);border-color:var(--green2);box-shadow:0 0 7px rgba(29,233,182,.4)}
.tl-dot.last{background:var(--red);border-color:var(--red);box-shadow:0 0 7px rgba(255,23,68,.4)}
.tl-dot.impacted{border-color:var(--orange);box-shadow:0 0 5px rgba(255,145,0,.35)}
.tl-dot.origin{background:var(--red);border-color:var(--red);box-shadow:0 0 10px rgba(255,23,68,.5)}
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

.board-wrap{padding:18px}
.board-title{font-family:"Bebas Neue",sans-serif;font-size:1.1rem;letter-spacing:.15em;color:var(--cyan);margin-bottom:12px}
.btable{width:100%;border-collapse:collapse}
.btable th{font-size:.56rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:5px 9px;text-align:left;border-bottom:1px solid var(--border)}
.btable td{padding:9px;border-bottom:1px solid #0b1525;font-size:.8rem;vertical-align:middle}
.btable tr:hover td{background:#060d1a;cursor:pointer}
.bt-time{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:1rem}
.bt-delay{font-family:"JetBrains Mono",monospace;font-size:.72rem;color:var(--orange)}
.bt-dest{font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-voie{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:.95rem;color:#5ba3f5}
.st-ok{color:var(--green);font-size:.65rem;font-weight:700}
.st-late{color:var(--orange);font-size:.65rem;font-weight:700}
.st-cancel{color:var(--red);font-size:.65rem;font-weight:700}

.sched-wrap{padding:18px}
.sched-line{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;animation:fadeUp .2s ease both}
.sched-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sched-times{display:flex;gap:6px;flex-wrap:wrap}
.sched-chip{background:var(--card2);border:1px solid var(--border2);border-radius:6px;padding:4px 9px;font-family:"JetBrains Mono",monospace;font-size:.78rem;color:var(--text)}
.sched-chip.rt{border-color:rgba(0,230,118,.3);color:var(--green)}
.sched-chip.late{border-color:rgba(255,145,0,.3);color:var(--orange)}

.disrup-wrap{padding:18px}
.dcard{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--orange);border-radius:8px;padding:12px 14px;margin-bottom:8px;animation:fadeUp .2s ease both}
.dcard.sev{border-left-color:var(--red)}.dcard.low{border-left-color:var(--blue)}
.dcard-title{font-weight:700;font-size:.84rem;margin-bottom:3px}
.dcard-meta{font-size:.66rem;color:var(--muted);margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap}
.dcard-msg{font-size:.74rem;color:#8899aa;line-height:1.5}
.eff{display:inline-block;font-size:.58rem;font-weight:700;padding:2px 7px;border-radius:20px;margin-top:5px}
.eff-stop{background:rgba(255,23,68,.08);color:var(--red);border:1px solid rgba(255,23,68,.2)}
.eff-delay{background:rgba(255,145,0,.08);color:var(--orange);border:1px solid rgba(255,145,0,.2)}
.eff-ok{background:rgba(0,230,118,.08);color:var(--green);border:1px solid rgba(0,230,118,.2)}

.journey-wrap{padding:18px}
.jfields{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-end}
.jfield{flex:1;min-width:130px}
.jfield label{font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px}
.jfield input{width:100%;background:var(--card);border:1px solid var(--border2);border-radius:7px;padding:8px 11px;color:var(--text);font-size:.82rem;font-family:"DM Sans",sans-serif;outline:none}
.jfield input:focus{border-color:var(--blue)}
.jfield input::placeholder{color:var(--muted)}
.jbtn{background:var(--blue);color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:"DM Sans",sans-serif;white-space:nowrap}
.jcard{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px;animation:fadeUp .2s ease both}
.jcard-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.jcard-time{font-family:"JetBrains Mono",monospace;font-size:1rem;font-weight:700}
.jcard-dur{font-size:.72rem;color:var(--cyan);font-weight:700;background:rgba(0,194,212,.08);padding:2px 8px;border-radius:20px;border:1px solid rgba(0,194,212,.2)}
.jcard-secs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.jsec{padding:3px 8px;border-radius:5px;font-size:.68rem;font-weight:700;border:1px solid}
.jsec-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:.75rem}
.jsec-t{font-family:"JetBrains Mono",monospace;color:var(--blue2);font-weight:500;min-width:40px;flex-shrink:0}

.lines-wrap{padding:18px}
.lcard{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:11px 13px;margin-bottom:6px;animation:fadeUp .2s ease both}
.lcard-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.lcard-routes{font-size:.7rem;color:var(--muted)}

.sysinfo-wrap{padding:18px}
.si-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.si-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.si-label{font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px}
.si-val{font-family:"JetBrains Mono",monospace;font-size:1.3rem;font-weight:700;color:var(--blue2)}
.si-sub{font-size:.6rem;color:var(--muted);margin-top:2px}
.si-card.ok .si-val{color:var(--green)}.si-card.warn .si-val{color:var(--orange)}

.center{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--muted);text-align:center;padding:40px}
.csm{display:flex;flex-direction:column;align-items:center;padding:48px;gap:10px;color:var(--muted);text-align:center}
.ico{font-size:2rem;opacity:.25}.lbl{font-size:.85rem}.sub{font-size:.68rem;color:#1e2d40}
.spin{width:26px;height:26px;border:3px solid var(--border2);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite}

@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>

<div class="topbar">
  <div class="brand">🚄 <span>SNCF</span> OPS</div>
  <div class="clock" id="clock">--:--:--</div>
  <div class="live-badge"><div class="live-dot"></div>LIVE</div>
  <div class="search-wrap">
    <input class="search-input" id="search" type="text" placeholder="Gare d'observation…" autocomplete="off" spellcheck="false">
    <span class="search-icon" id="sico">⌕</span>
    <div class="search-spin" id="sspin"></div>
    <div class="sugg" id="sugg"></div>
  </div>
  <div class="api-stats">
    <div>API <span class="api-stat-n" id="s-api">0</span></div>
    <div>CACHE <span class="api-stat-n" id="s-cache">0</span></div>
    <div>ERR <span class="api-stat-n" id="s-err">0</span></div>
  </div>
  <div class="top-tabs">
    <div class="ttab active" onclick="setTab('train',this)">Trajet</div>
    <div class="ttab" onclick="setTab('board',this)">Tableau</div>
    <div class="ttab" onclick="setTab('schedules',this)">Horaires</div>
    <div class="ttab" onclick="setTab('arrivals',this)">Arrivées</div>
    <div class="ttab" onclick="setTab('journey',this)">Itinéraire</div>
    <div class="ttab" onclick="setTab('lines',this)">Lignes</div>
    <div class="ttab" onclick="setTab('disruptions',this)">Alertes <span class="cnt" id="dcnt" style="display:none">0</span></div>
    <div class="ttab" onclick="setTab('sysinfo',this)">Système</div>
  </div>
</div>
<div class="refresh-bar"><div class="refresh-prog" id="rprog"></div></div>

<div class="workspace">
  <div class="sidebar">
    <div class="sidebar-head">
      <div class="sgare" id="sgare">Aucune gare</div>
      <div class="kpis" id="kpis" style="display:none">
        <div class="kpi ok"><div class="kpi-n" id="k-ok">0</div><div class="kpi-l">OK</div></div>
        <div class="kpi warn"><div class="kpi-n" id="k-late">0</div><div class="kpi-l">Retard</div></div>
        <div class="kpi danger"><div class="kpi-n" id="k-cancel">0</div><div class="kpi-l">Suppr.</div></div>
        <div class="kpi info"><div class="kpi-n" id="k-total">0</div><div class="kpi-l">Total</div></div>
      </div>
    </div>
    <div class="tlist" id="tlist">
      <div class="center"><div class="ico">🔍</div><div class="lbl">Aucune gare</div><div class="sub">Utilisez la barre de recherche</div></div>
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
      <div class="vtab" data-v="sysinfo" onclick="vswitch(this)">⚙️ Système</div>
    </div>
    <div class="view active" id="view-train"><div class="center"><div class="ico">🚄</div><div class="lbl">Sélectionnez un train</div><div class="sub">Cliquez sur un départ à gauche</div></div></div>
    <div class="view" id="view-board"><div class="center"><div class="ico">📋</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-schedules"><div class="center"><div class="ico">🕐</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-arrivals"><div class="center"><div class="ico">🚉</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-journey">
      <div class="journey-wrap">
        <div class="board-title">🧭 CALCULATEUR D'ITINÉRAIRE</div>
        <div class="jfields">
          <div class="jfield"><label>Départ (ID gare)</label><input id="j-from" placeholder="stop_area:SNCF:87…"></div>
          <div class="jfield"><label>Arrivée (ID gare)</label><input id="j-to" placeholder="stop_area:SNCF:87…"></div>
          <button class="jbtn" onclick="calcJourney()">Calculer →</button>
        </div>
        <div id="jresult"></div>
      </div>
    </div>
    <div class="view" id="view-lines"><div class="center"><div class="ico">🗺</div><div class="lbl">Sélectionnez une gare</div></div></div>
    <div class="view" id="view-disruptions"><div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div></div>
    <div class="view" id="view-sysinfo"><div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div></div>
  </div>
</div>

<script>
var G={stop:null,deps:[],rl:30,rm:30};

// ── Horloge ──────────────────────────────────────────
function tick(){
  var n=new Date(),el=document.getElementById("clock");
  if(el) el.textContent=[n.getHours(),n.getMinutes(),n.getSeconds()].map(function(x){return String(x).padStart(2,"0");}).join(":");
}
tick();
setInterval(tick,1000);

// ── Refresh bar ───────────────────────────────────────
setInterval(function(){
  G.rl--;
  document.getElementById("rprog").style.width=(((G.rm-G.rl)/G.rm)*100)+"%";
  if(G.rl<=0){if(G.stop)loadDeps(G.stop.id,G.stop.name,false);G.rl=G.rm;}
},1000);

// ── Stats API ──────────────────────────────────────────
setInterval(function(){
  fetch("/api/stats").then(function(r){return r.json();}).then(function(d){
    document.getElementById("s-api").textContent=d.api||0;
    document.getElementById("s-cache").textContent=d.cached||0;
    document.getElementById("s-err").textContent=d.errors||0;
    var sv=document.getElementById("view-sysinfo");
    if(sv&&sv.classList.contains("active"))renderSys(d);
  }).catch(function(){});
},5000);

// ── Utils ─────────────────────────────────────────────
function p2(n){return String(n).padStart(2,"0");}
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function fmtT(s){if(!s||s.length<13)return"--:--";return s.slice(9,11)+":"+s.slice(11,13);}
function fmtST(s){if(!s||s.length<4)return"--:--";var h=parseInt(s.slice(0,2)),m=s.slice(2,4);return(h>=24?p2(h-24):p2(h))+":"+m;}
function dur(s){var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?h+"h"+p2(m):m+"min";}
function getDelay(dep){
  var b=dep&&dep.stop_date_time&&dep.stop_date_time.base_departure_date_time;
  var a=dep&&dep.stop_date_time&&dep.stop_date_time.departure_date_time;
  if(!b||!a||b===a)return 0;
  return(parseInt(a.slice(9,11))*60+parseInt(a.slice(11,13)))-(parseInt(b.slice(9,11))*60+parseInt(b.slice(11,13)));
}
function delayST(b,a){
  if(!b||!a||b===a)return 0;
  var d=(parseInt(a.slice(0,2))*60+parseInt(a.slice(2,4)))-(parseInt(b.slice(0,2))*60+parseInt(b.slice(2,4)));
  return d<-60?d+1440:d;
}
function lcolor(info){
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
function isCanc(dep){return(dep.disruptions||[]).some(function(x){return x.severity&&x.severity.effect==="NO_SERVICE";});}

// ── Tabs ──────────────────────────────────────────────
function vswitch(el){
  document.querySelectorAll(".vtab").forEach(function(t){t.classList.remove("active");});
  document.querySelectorAll(".view").forEach(function(v){v.classList.remove("active");});
  el.classList.add("active");
  document.getElementById("view-"+el.dataset.v).classList.add("active");
  if(el.dataset.v==="arrivals"&&G.stop)loadArrivals(G.stop.id);
  if(el.dataset.v==="disruptions")loadDisruptions();
  if(el.dataset.v==="schedules"&&G.stop)loadSchedules(G.stop.id);
  if(el.dataset.v==="lines"&&G.stop)loadLines(G.stop.id);
  if(el.dataset.v==="sysinfo"){fetch("/api/stats").then(function(r){return r.json();}).then(renderSys).catch(function(){});}
}
function setTab(v,el){
  var t=document.querySelector(".vtab[data-v='"+v+"']");
  if(t)vswitch(t);
  document.querySelectorAll(".ttab").forEach(function(t){t.classList.remove("active");});
  if(el)el.classList.add("active");
}

// ── Recherche ─────────────────────────────────────────
var stimer=null;
document.getElementById("search").addEventListener("input",function(){
  clearTimeout(stimer);
  var q=this.value.trim();
  if(q.length<2){hideSugg();return;}
  document.getElementById("sspin").classList.add("on");
  document.getElementById("sico").style.display="none";
  stimer=setTimeout(function(){doSearch(q);},400);
});
document.addEventListener("click",function(e){if(!e.target.closest(".search-wrap"))hideSugg();});
function hideSugg(){document.getElementById("sugg").classList.remove("on");}

function doSearch(q){
  fetch("/api/places?q="+encodeURIComponent(q))
    .then(function(r){return r.json();})
    .then(function(d){
      var stops=(d.places||[]).filter(function(p){return p.embedded_type==="stop_area";});
      if(!stops.length){hideSugg();return;}
      var html=stops.map(function(p){
        var s=p.stop_area||p;
        var reg=p.administrative_regions&&p.administrative_regions[0]&&p.administrative_regions[0].name||"";
        return'<div class="sug" data-id="'+esc(s.id)+'" data-name="'+esc(p.name)+'">'
          +'<span style="color:var(--blue2)">📍</span>'
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
    })
    .catch(function(){hideSugg();})
    .finally(function(){
      document.getElementById("sspin").classList.remove("on");
      document.getElementById("sico").style.display="";
    });
}

// ── Départs ───────────────────────────────────────────
function loadDeps(stopId,name,showLoad){
  G.stop={id:stopId,name:name};G.rl=G.rm;
  if(showLoad){
    document.getElementById("tlist").innerHTML='<div class="center"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
    document.getElementById("kpis").style.display="none";
  }
  fetch("/api/departures?stop="+encodeURIComponent(stopId))
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.error)throw new Error(d.error);
      G.deps=d.departures||[];
      renderDeps(G.deps,name);
      renderBoard(G.deps,name);
      var sv=document.querySelector(".vtab[data-v='schedules']");
      if(sv&&sv.classList.contains("active"))loadSchedules(stopId);
      var lv=document.querySelector(".vtab[data-v='lines']");
      if(lv&&lv.classList.contains("active"))loadLines(stopId);
    })
    .catch(function(e){
      document.getElementById("tlist").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';
    });
}

function renderDeps(deps,name){
  document.getElementById("sgare").textContent="📍 "+name;
  var nOk=0,nL=0,nC=0;
  deps.forEach(function(d){var c=isCanc(d);if(c)nC++;else if(getDelay(d)>0)nL++;else nOk++;});
  document.getElementById("k-ok").textContent=nOk;
  document.getElementById("k-late").textContent=nL;
  document.getElementById("k-cancel").textContent=nC;
  document.getElementById("k-total").textContent=deps.length;
  document.getElementById("kpis").style.display="flex";
  if(!deps.length){document.getElementById("tlist").innerHTML='<div class="center"><div class="ico">🚉</div><div class="lbl">Aucun départ</div></div>';return;}

  var html=deps.map(function(dep,i){
    var info=dep.display_informations||{};
    var dt=dep.stop_date_time||{};
    var delay=getDelay(dep),canc=isCanc(dep);
    var cause=(dep.disruptions&&dep.disruptions[0]&&dep.disruptions[0].cause)||"";
    var plat=dt.platform_code||null;
    var col=lcolor(info),mat=getMat(info.headsign,info.commercial_mode);
    var vjId=((dep.links||[]).find(function(l){return l.type==="vehicle_journey";})||{}).id||"";
    var cls="tcard"+(canc?" cancelled":delay>=15?" verylate":delay>0?" late":"");
    var dc=canc?"var(--red)":delay>0?"var(--orange)":"var(--text)";
    var badges="";
    if(!canc&&delay===0)badges+='<span class="b b-ok">✓ A l&#39;heure</span>';
    if(!canc&&delay>0)badges+='<span class="b b-late">+'+delay+'min</span>';
    if(canc)badges+='<span class="b b-cancel">Supprimé</span>';
    if(cause)badges+='<span class="b-cause">⚠ '+esc(cause)+'</span>';
    return'<div class="'+cls+'" style="border-left-color:'+col+';animation-delay:'+(i*25)+'ms"'
      +' data-vjid="'+esc(vjId)+'" data-hs="'+esc(info.headsign||"")+'"'
      +' data-mode="'+esc(info.commercial_mode||"")+'" data-dir="'+esc(info.direction||"")+'"'
      +' data-col="'+esc(col)+'">'
      +'<div class="tc-row"><div class="tc-left">'
      +'<div style="margin-bottom:2px"><span class="mchip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(info.commercial_mode||"TRAIN")+'</span>'
      +'<span class="tnum">'+esc(info.headsign||"—")+'</span></div>'
      +'<div class="tdir">→ '+esc((info.direction||"—").split("(")[0].trim())+'</div>'
      +'<div class="brow">'+badges+(mat?'<span style="color:#3d5475;font-size:.55rem;font-style:italic">· '+esc(mat)+'</span>':"")+'</div>'
      +'</div><div class="tc-right">'
      +'<div class="dtime" style="color:'+dc+'">'+(canc?"SUPP":fmtT(dt.departure_date_time))+'</div>'
      +(delay>0&&!canc?'<div class="dbase">'+fmtT(dt.base_departure_date_time)+'</div>':"")
      +(plat?'<div class="voie">Voie '+esc(plat)+'</div>':"")
      +'</div></div></div>';
  }).join("");

  document.getElementById("tlist").innerHTML=html;
  document.querySelectorAll(".tcard").forEach(function(el){
    el.addEventListener("click",function(){
      document.querySelectorAll(".tcard").forEach(function(c){c.classList.remove("sel");});
      this.classList.add("sel");
      setTab("train",null);
      showTrain(this.dataset.vjid,this.dataset.hs,this.dataset.mode,this.dataset.dir,this.dataset.col);
    });
  });
}

// ── Board ─────────────────────────────────────────────
function renderBoard(deps,name){
  if(!deps.length){document.getElementById("view-board").innerHTML='<div class="center"><div class="ico">📋</div><div class="lbl">Aucun départ</div></div>';return;}
  var rows=deps.map(function(dep){
    var info=dep.display_informations||{},dt=dep.stop_date_time||{};
    var delay=getDelay(dep),canc=isCanc(dep),col=lcolor(info);
    var vjId=((dep.links||[]).find(function(l){return l.type==="vehicle_journey";})||{}).id||"";
    return'<tr data-vjid="'+esc(vjId)+'" data-hs="'+esc(info.headsign||"")+'" data-mode="'+esc(info.commercial_mode||"")+'" data-dir="'+esc(info.direction||"")+'" data-col="'+esc(col)+'">'
      +'<td><span class="bt-time" style="color:'+(canc?"var(--red)":delay>0?"var(--orange)":"var(--text)")+'">'+fmtT(dt.departure_date_time)+'</span>'
      +(delay>0&&!canc?'<div class="bt-delay">'+fmtT(dt.base_departure_date_time)+'</div>':"")+'</td>'
      +'<td><span class="mchip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(info.commercial_mode||"?")+'</span>'
      +'<span style="font-family:JetBrains Mono,monospace;font-size:.75rem">'+esc(info.headsign||"")+'</span></td>'
      +'<td class="bt-dest">'+esc((info.direction||"—").split("(")[0].trim())+'</td>'
      +'<td class="bt-voie">'+(dt.platform_code||"—")+'</td>'
      +'<td>'+(canc?'<span class="st-cancel">SUPPRIMÉ</span>':delay>0?'<span class="st-late">+'+delay+'min</span>':'<span class="st-ok">OK</span>')+'</td>'
      +'</tr>';
  }).join("");
  document.getElementById("view-board").innerHTML='<div class="board-wrap"><div class="board-title">📋 DÉPARTS — '+esc(name)+'</div>'
    +'<table class="btable"><thead><tr><th>HEURE</th><th>TRAIN</th><th>DESTINATION</th><th>VOIE</th><th>ÉTAT</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  document.querySelectorAll(".btable tbody tr").forEach(function(tr){
    tr.addEventListener("click",function(){setTab("train",null);showTrain(this.dataset.vjid,this.dataset.hs,this.dataset.mode,this.dataset.dir,this.dataset.col);});
  });
}

// ── Schedules ─────────────────────────────────────────
function loadSchedules(stopId){
  document.getElementById("view-schedules").innerHTML='<div class="csm"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
  fetch("/api/schedules?stop="+encodeURIComponent(stopId))
    .then(function(r){return r.json();})
    .then(function(d){
      var sc=d.stop_schedules||[];
      if(!sc.length){document.getElementById("view-schedules").innerHTML='<div class="center"><div class="ico">🕐</div><div class="lbl">Aucun horaire</div></div>';return;}
      var html='<div class="sched-wrap"><div class="board-title">🕐 HORAIRES — '+esc(G.stop&&G.stop.name||"")+'</div>';
      sc.forEach(function(s,i){
        var route=s.route||{},line=route.line||{},col=line.color?"#"+line.color:"var(--blue)";
        var times=(s.date_times||[]).map(function(dt){
          var rt=dt.data_freshness==="realtime";
          var delay=dt.base_date_time&&dt.date_time&&dt.base_date_time!==dt.date_time?delayST(dt.base_date_time.slice(9),dt.date_time.slice(9)):0;
          return'<span class="sched-chip'+(rt&&delay>0?" late":rt?" rt":"")+'">'
            +fmtT(dt.date_time||dt.base_date_time)+(delay>0?' <span style="font-size:.55rem">+'+delay+'</span>':"")+'</span>';
        }).join("");
        html+='<div class="sched-line" style="animation-delay:'+(i*25)+'ms">'
          +'<div class="sched-head"><span class="mchip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(line.commercial_mode&&line.commercial_mode.name||"LIGNE")+'</span>'
          +'<span style="font-weight:700;font-size:.85rem">'+esc(line.code||line.name||"")+'</span>'
          +'<span style="color:var(--muted);font-size:.72rem;flex:1">→ '+esc(route.direction&&route.direction.stop_area&&route.direction.stop_area.name||route.name||"")+'</span></div>'
          +(times?'<div class="sched-times">'+times+'</div>':'<div style="color:var(--muted);font-size:.72rem">Pas de départ imminent</div>')
          +'</div>';
      });
      document.getElementById("view-schedules").innerHTML=html+'</div>';
    })
    .catch(function(e){document.getElementById("view-schedules").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';});
}

// ── Arrivées ──────────────────────────────────────────
function loadArrivals(stopId){
  document.getElementById("view-arrivals").innerHTML='<div class="csm"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
  fetch("/api/arrivals?stop="+encodeURIComponent(stopId))
    .then(function(r){return r.json();})
    .then(function(d){
      var arrs=d.arrivals||[];
      if(!arrs.length){document.getElementById("view-arrivals").innerHTML='<div class="center"><div class="ico">🚉</div><div class="lbl">Aucune arrivée</div></div>';return;}
      var rows=arrs.map(function(arr){
        var info=arr.display_informations||{},dt=arr.stop_date_time||{};
        var bA=dt.base_arrival_date_time,rA=dt.arrival_date_time;
        var delay=bA&&rA&&bA!==rA?(parseInt(rA.slice(9,11))*60+parseInt(rA.slice(11,13)))-(parseInt(bA.slice(9,11))*60+parseInt(bA.slice(11,13))):0;
        var col=lcolor(info),canc=isCanc(arr);
        return'<tr><td><span class="bt-time" style="color:'+(canc?"var(--red)":delay>0?"var(--orange)":"var(--text)")+'">'+fmtT(rA)+'</span>'
          +(delay>0?'<div class="bt-delay">'+fmtT(bA)+'</div>':"")+'</td>'
          +'<td><span class="mchip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(info.commercial_mode||"?")+'</span>'
          +'<span style="font-family:JetBrains Mono,monospace;font-size:.75rem">'+esc(info.headsign||"")+'</span></td>'
          +'<td class="bt-dest" style="color:#5a7a9a">De '+esc((info.direction||"—").split("(")[0].trim())+'</td>'
          +'<td class="bt-voie">'+(dt.platform_code||"—")+'</td>'
          +'<td>'+(canc?'<span class="st-cancel">SUPPRIMÉ</span>':delay>0?'<span class="st-late">+'+delay+'min</span>':'<span class="st-ok">OK</span>')+'</td>'
          +'</tr>';
      }).join("");
      document.getElementById("view-arrivals").innerHTML='<div class="board-wrap"><div class="board-title">🚉 ARRIVÉES — '+esc(G.stop&&G.stop.name||"")+'</div>'
        +'<table class="btable"><thead><tr><th>HEURE</th><th>TRAIN</th><th>PROVENANCE</th><th>VOIE</th><th>ÉTAT</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    })
    .catch(function(e){document.getElementById("view-arrivals").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';});
}

// ── Disruptions ───────────────────────────────────────
function loadDisruptions(){
  document.getElementById("view-disruptions").innerHTML='<div class="csm"><div class="spin"></div><div class="lbl">Chargement alertes…</div></div>';
  fetch("/api/disruptions")
    .then(function(r){return r.json();})
    .then(function(d){
      var list=d.disruptions||[];
      var cnt=document.getElementById("dcnt");
      cnt.textContent=list.length;cnt.style.display=list.length?"":"none";
      if(!list.length){document.getElementById("view-disruptions").innerHTML='<div class="center"><div class="ico">✅</div><div class="lbl">Aucune perturbation</div><div class="sub">Réseau nominal</div></div>';return;}
      var html='<div class="disrup-wrap"><div class="board-title">⚠️ PERTURBATIONS ('+list.length+')</div>';
      html+=list.map(function(d,i){
        var eff=d.severity&&d.severity.effect||"";
        var cause=d.cause||"";
        // Accès sécurisé aux messages
        var msg="";
        var msgs=d.messages||[];
        for(var mi=0;mi<msgs.length;mi++){if(msgs[mi]&&(msgs[mi].text||msgs[mi].value)){msg=msgs[mi].text||msgs[mi].value;break;}}
        var isSev=eff==="NO_SERVICE"||eff==="SIGNIFICANT_DELAYS";
        var effLbl=eff==="NO_SERVICE"?"TRAFIC INTERROMPU":eff==="SIGNIFICANT_DELAYS"?"RETARDS IMPORTANTS":eff==="REDUCED_SERVICE"?"SERVICE RÉDUIT":"INFO";
        var effCls=isSev?"eff-stop":"eff-delay";
        var lines=(d.impacted_objects||[]).slice(0,3).map(function(o){return o.pt_object&&o.pt_object.name||"";}).filter(Boolean).join(", ");
        return'<div class="dcard'+(isSev?" sev":"")+'" style="animation-delay:'+(i*25)+'ms">'
          +'<div class="dcard-title">'+esc(cause||(msg&&msg.slice(0,70))||"Perturbation réseau")+'</div>'
          +(lines?'<div class="dcard-meta"><span>🚆 '+esc(lines)+'</span></div>':"")
          +(msg?'<div class="dcard-msg">'+esc(msg)+'</div>':"")
          +'<span class="eff '+effCls+'">'+effLbl+'</span></div>';
      }).join("");
      document.getElementById("view-disruptions").innerHTML=html+'</div>';
    })
    .catch(function(e){document.getElementById("view-disruptions").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';});
}

// ── Lignes ─────────────────────────────────────────────
function loadLines(stopId){
  document.getElementById("view-lines").innerHTML='<div class="csm"><div class="spin"></div><div class="lbl">Chargement…</div></div>';
  fetch("/api/lines?stop="+encodeURIComponent(stopId))
    .then(function(r){return r.json();})
    .then(function(d){
      var lines=d.lines||[];
      if(!lines.length){document.getElementById("view-lines").innerHTML='<div class="center"><div class="ico">🗺</div><div class="lbl">Aucune ligne</div></div>';return;}
      var html='<div class="lines-wrap"><div class="board-title">🗺 LIGNES — '+esc(G.stop&&G.stop.name||"")+'</div>';
      html+=lines.map(function(l,i){
        var col=l.color?"#"+l.color:"var(--blue)";
        var routes=(l.routes||[]).slice(0,3).map(function(ro){return ro.direction&&ro.direction.stop_area&&ro.direction.stop_area.name||ro.name||"";}).filter(Boolean).join(" · ");
        return'<div class="lcard" style="animation-delay:'+(i*20)+'ms">'
          +'<div class="lcard-head"><span class="mchip" style="background:'+col+'1a;color:'+col+';border:1px solid '+col+'30">'+esc(l.commercial_mode&&l.commercial_mode.name||"LIGNE")+'</span>'
          +'<span style="font-weight:700;font-size:.9rem">'+esc(l.code||l.name||"")+'</span>'
          +'<span style="color:var(--muted);font-size:.72rem;flex:1">'+esc(l.name||"")+'</span>'
          +(l.opening_time&&l.closing_time?'<span style="font-family:JetBrains Mono,monospace;font-size:.62rem;color:var(--muted)">'+l.opening_time.slice(0,2)+":"+l.opening_time.slice(2,4)+" – "+l.closing_time.slice(0,2)+":"+l.closing_time.slice(2,4)+'</span>':"")
          +'</div>'
          +(routes?'<div class="lcard-routes">↔ '+esc(routes)+'</div>':"")
          +'</div>';
      }).join("");
      document.getElementById("view-lines").innerHTML=html+'</div>';
    })
    .catch(function(e){document.getElementById("view-lines").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';});
}

// ── Itinéraire ────────────────────────────────────────
function calcJourney(){
  var from=document.getElementById("j-from").value.trim();
  var to=document.getElementById("j-to").value.trim();
  if(!from||!to){document.getElementById("jresult").innerHTML='<div style="color:var(--orange);font-size:.8rem;padding:10px">Renseignez le départ et l\'arrivée.</div>';return;}
  document.getElementById("jresult").innerHTML='<div class="csm"><div class="spin"></div><div class="lbl">Calcul en cours…</div></div>';
  fetch("/api/journeys?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to))
    .then(function(r){return r.json();})
    .then(function(d){
      var journeys=d.journeys||[];
      if(!journeys.length){document.getElementById("jresult").innerHTML='<div style="color:var(--muted);padding:20px;font-size:.82rem">Aucun itinéraire. Utilisez des IDs stop_area (ex: stop_area:SNCF:87...).</div>';return;}
      var html=journeys.map(function(j,i){
        var dep=j.departure_date_time,arr=j.arrival_date_time;
        var dH=dep?dep.slice(9,11)+":"+dep.slice(11,13):"?";
        var aH=arr?arr.slice(9,11)+":"+arr.slice(11,13):"?";
        var secs=j.sections||[];
        var chips=secs.map(function(s){
          if(s.type==="waiting")return'<span class="jsec" style="background:rgba(255,255,255,.04);color:var(--muted);border-color:var(--border)">⏳ '+Math.round((s.duration||0)/60)+'min</span>';
          if(s.type==="street_network"||s.type==="crow_fly")return'<span class="jsec" style="background:rgba(0,194,212,.06);color:var(--cyan);border-color:rgba(0,194,212,.2)">🚶 '+Math.round((s.duration||0)/60)+'min</span>';
          if(s.type==="public_transport"){var info=s.display_informations||{},col=lcolor(info);return'<span class="jsec" style="background:'+col+'15;color:'+col+';border-color:'+col+'30">'+esc(info.commercial_mode||"🚄")+" "+esc(info.headsign||"")+'</span>';}
          return"";
        }).filter(Boolean).join("");
        var detail=secs.map(function(s){
          if(s.type==="waiting")return'<div class="jsec-row"><span class="jsec-t"></span><span>⏳</span><span style="color:var(--muted)">Correspondance '+Math.round((s.duration||0)/60)+'min</span></div>';
          if(s.type==="street_network"||s.type==="crow_fly")return'<div class="jsec-row"><span class="jsec-t">'+(s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"")+'</span><span>🚶</span><span>A pied · '+Math.round((s.duration||0)/60)+'min</span></div>';
          if(s.type==="public_transport"){
            var info=s.display_informations||{},col=lcolor(info);
            var f2=s.from&&(s.from.stop_point&&s.from.stop_point.name||s.from.name)||"";
            var t2=s.to&&(s.to.stop_point&&s.to.stop_point.name||s.to.name)||"";
            var dT2=s.departure_date_time?s.departure_date_time.slice(9,11)+":"+s.departure_date_time.slice(11,13):"";
            return'<div class="jsec-row"><span class="jsec-t">'+dT2+'</span><span>🚄</span><span><strong style="color:'+col+'">'+esc(info.commercial_mode||"")+" "+esc(info.headsign||"")+'</strong> '+esc(f2)+' → <strong>'+esc(t2)+'</strong></span></div>';
          }
          return"";
        }).filter(Boolean).join("");
        return'<div class="jcard" style="animation-delay:'+(i*50)+'ms">'
          +'<div class="jcard-head"><div><div class="jcard-time">'+dH+' → '+aH+'</div>'
          +'<div style="font-size:.7rem;color:var(--muted);margin-top:2px">'+(j.nb_transfers||0)+' correspondance'+(j.nb_transfers!==1?"s":"")+'</div></div>'
          +'<div class="jcard-dur">'+dur(j.duration||0)+'</div></div>'
          +'<div class="jcard-secs">'+chips+'</div>'
          +'<div>'+detail+'</div>'
          +'</div>';
      }).join("");
      document.getElementById("jresult").innerHTML=html;
    })
    .catch(function(e){document.getElementById("jresult").innerHTML='<div style="color:var(--red);padding:12px;font-size:.8rem">⚠️ '+esc(e.message)+'</div>';});
}

// ── Système ───────────────────────────────────────────
function renderSys(d){
  var up=d.uptime||0,h=Math.floor(up/3600),m=Math.floor((up%3600)/60),s=up%60;
  document.getElementById("view-sysinfo").innerHTML='<div class="sysinfo-wrap">'
    +'<div class="board-title">⚙️ SYSTÈME & QUOTA API</div>'
    +'<div class="si-grid">'
    +'<div class="si-card ok"><div class="si-label">Cachées</div><div class="si-val">'+(d.cached||0)+'</div><div class="si-sub">Requêtes économisées</div></div>'
    +'<div class="si-card"><div class="si-label">Appels API</div><div class="si-val">'+(d.api||0)+'</div><div class="si-sub">Sur ~5000/mois</div></div>'
    +'<div class="si-card"><div class="si-label">Total</div><div class="si-val">'+(d.total||0)+'</div><div class="si-sub">Depuis démarrage</div></div>'
    +'<div class="si-card '+(d.errors>0?"warn":"ok")+'"><div class="si-label">Erreurs</div><div class="si-val">'+(d.errors||0)+'</div></div>'
    +'<div class="si-card"><div class="si-label">Cache</div><div class="si-val">'+(d.cacheSize||0)+'</div><div class="si-sub">Entrées actives</div></div>'
    +'<div class="si-card ok"><div class="si-label">Uptime</div><div class="si-val" style="font-size:.9rem">'+(h>0?h+"h ":"")+m+"m "+s+"s"+'</div></div>'
    +'</div></div>';
}

// ── Trajet détaillé ────────────────────────────────────
function showTrain(vjId,hs,mode,dir,col){
  document.getElementById("view-train").innerHTML='<div class="center"><div class="spin"></div><div class="lbl">Chargement trajet…</div></div>';
  if(!vjId){document.getElementById("view-train").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">ID introuvable</div></div>';return;}
  fetch("/api/vehicle?id="+encodeURIComponent(vjId))
    .then(function(r){return r.json();})
    .then(function(d){
      var vj=d.vehicle_journeys&&d.vehicle_journeys[0];
      if(!vj)throw new Error("Trajet introuvable");
      var disrup=d.disruptions&&d.disruptions[0];
      var impacted=(disrup&&disrup.impacted_objects&&disrup.impacted_objects[0]&&disrup.impacted_objects[0].impacted_stops)||[];
      var msgs=disrup&&disrup.messages||[];
      var disrupMsg="";for(var mi=0;mi<msgs.length;mi++){if(msgs[mi]&&(msgs[mi].text||msgs[mi].value)){disrupMsg=msgs[mi].text||msgs[mi].value;break;}}
      if(!disrupMsg&&disrup)disrupMsg=disrup.cause||"";
      var mat=getMat(hs,mode),stops=vj.stop_times||[];

      var delayData=stops.map(function(st){
        var imp=impacted.find(function(x){return x.stop_point&&x.stop_point.id===st.stop_point.id;});
        var bT=imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
        var aT=imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
        return{name:st.stop_point&&st.stop_point.name||"?",delay:delayST(bT,aT)};
      });
      var maxDelay=delayData.reduce(function(m,d){return Math.max(m,d.delay);},0);

      var heroHTML='<div class="train-hero" data-num="'+esc(hs)+'">'
        +'<div class="hero-num" style="color:'+col+'">'+esc(hs)+'</div>'
        +'<div class="hero-dir">→ '+esc((dir||"").split("(")[0].trim())+'</div>'
        +'<div class="hero-badges">'
        +'<span class="hbadge" style="background:'+col+'15;color:'+col+';border-color:'+col+'30">'+esc(mode)+'</span>'
        +(mat?'<span class="hbadge" style="background:#0f2040;color:#5ba3f5;border-color:#1a3566">'+esc(mat)+'</span>':"")
        +'<span class="hbadge" style="background:#0d1c2e;color:var(--muted);border-color:var(--border)">'+stops.length+' arrêts</span>'
        +(maxDelay>0?'<span class="hbadge" style="background:rgba(255,145,0,.08);color:var(--orange);border-color:rgba(255,145,0,.2)">+'+maxDelay+'min max</span>':"")
        +'</div></div>';

      var alertHTML='<div class="alert-box'+(disrupMsg?" on":"")+'"><strong>⚡ PERTURBATION</strong>'+esc(disrupMsg)+'</div>';

      var chartHTML="";
      if(maxDelay>0){
        var bars=delayData.map(function(d){
          var pct=maxDelay>0?Math.round((d.delay/maxDelay)*100):0;
          var bc=d.delay>=15?"var(--red)":d.delay>0?"var(--orange)":"var(--border2)";
          return'<div class="cbar-wrap"><div class="cbar" style="height:'+pct+'%;background:'+bc+'" title="'+esc(d.name)+' +'+d.delay+'min"></div><div class="cbar-lbl">'+esc(d.name.split(" ")[0])+'</div></div>';
        }).join("");
        chartHTML='<div class="chart-wrap on"><div class="chart-title">📊 RETARD PAR ARRÊT</div><div class="chart-bars">'+bars+'</div></div>';
      }

      var prevDelay=0,delayStarted=false,tlHTML='<div class="timeline">';
      stops.forEach(function(st,i){
        var isFirst=i===0,isLast=i===stops.length-1;
        var imp=impacted.find(function(x){return x.stop_point&&x.stop_point.id===st.stop_point.id;});
        var bT=imp?(imp.base_departure_time||imp.base_arrival_time):st.departure_time||st.arrival_time;
        var aT=imp?(imp.amended_departure_time||imp.amended_arrival_time):st.departure_time||st.arrival_time;
        var delay=delayST(bT,aT),plat=(st.stop_point&&st.stop_point.platform_code)||(imp&&imp.stop_point&&imp.stop_point.platform_code)||null;
        var isImp=delay>0,isOrigin=isImp&&!delayStarted,isCatch=isImp&&delay<prevDelay&&prevDelay>0;
        if(isImp)delayStarted=true;
        var dotCls="tl-dot"+(isFirst?" first":isLast?" last":isOrigin?" origin":isImp?" impacted":"");
        tlHTML+='<div class="tl-stop" style="animation-delay:'+(i*12)+'ms">'
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
      document.getElementById("view-train").innerHTML=heroHTML+alertHTML+chartHTML+tlHTML+"</div>";
    })
    .catch(function(e){document.getElementById("view-train").innerHTML='<div class="center"><div class="ico">⚠️</div><div class="lbl">'+esc(e.message)+'</div></div>';});
}

// Init
loadDisruptions();
</script>
</body>
</html>`;
