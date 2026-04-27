#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNCF OPS CENTER — Serveur avec cache intelligent
// Restauré et Corrigé pour Render.com
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const http  = require("http");
const https = require("https");
const url   = require("url");

// Priorité aux variables d'environnement Render
const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT     = process.env.PORT || 10000;
const BASE_URL = "api.sncf.com";
const BASE_PATH = "/v1/coverage/sncf/";

if (!API_KEY) {
  console.error("\n❌ Clé API manquante !");
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CACHE — économise les requêtes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const cache = new Map();
const CACHE_TTL = {
  places:       300000, 
  departures:   20000,      
  arrivals:     20000,       
  vehicle:      30000,       
  disruptions:  60000,       
  traffic:      60000,       
  schedules:    20000,       
  lines:        600000,  
  journeys:     120000,   
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

const stats = { total: 0, cached: 0, api: 0, errors: 0, startTime: Date.now() };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APPEL API SNCF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const pad = n => String(n).padStart(2, "0");
const log = (e, m) => console.log("[" + new Date().toLocaleTimeString() + "] " + e + "  " + m);

function sncfGet(path, ttlKey) {
  const cached = cacheGet(path);
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
          cacheSet(path, data, CACHE_TTL[ttlKey] || 30000);
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

  if (path === "/api/stats") {
    res.end(JSON.stringify({ ...stats, uptime: Math.round((Date.now() - stats.startTime) / 1000) }));
    return;
  }

  try {
    let data;
    const dt = nowNavitia();

    if (path === "/api/places") {
      data = await sncfGet("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area&count=8", "places");
    }
    else if (path === "/api/departures") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?from_datetime=" + dt + "&count=40&data_freshness=base_schedule&depth=2", "departures");
    }
    else if (path === "/api/arrivals") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?from_datetime=" + dt + "&count=40&data_freshness=base_schedule&depth=2", "arrivals");
    }
    else if (path === "/api/vehicle") {
      data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=base_schedule", "vehicle");
    }
    else if (path === "/api/disruptions") {
      data = await sncfGet("disruptions?count=50&depth=2", "disruptions");
    }
    else {
      res.writeHead(404);
      res.end(JSON.stringify({error: "Not found"}));
      return;
    }
    res.end(JSON.stringify(data));
  } catch(e) {
    res.end(JSON.stringify({error: e.message}));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log("READY", "SNCF OPS CENTER sur port " + PORT);
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
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#04070e;--panel:#070d18;--card:#0b1422;--card2:#0e1928;
  --border:#13253d;--border2:#1a3354;
  --text:#ccd9ee;--muted:#3d5475;
  --blue:#2f80ed;--blue2:#56a0f5;--cyan:#00c2d4;
  --green:#00e676;--red:#ff1744;--orange:#ff9100;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:"DM Sans",sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}

.topbar{height:52px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:16px;z-index:100}
.brand{font-family:"Bebas Neue",sans-serif;font-size:1.5rem;color:var(--blue2);letter-spacing:.1em}
.clock{font-family:"JetBrains Mono",monospace;font-size:.9rem;color:var(--cyan);margin-left:auto}

.search-wrap{position:relative;flex:1;max-width:380px}
.search-wrap input{width:100%;background:var(--card);border:1px solid var(--border2);border-radius:8px;padding:8px 12px;color:white;outline:none;font-size:14px}
.sugg{position:absolute;top:100%;left:0;right:0;background:#0a1525;border:1px solid var(--border2);border-radius:0 0 8px 8px;display:none;z-index:1000;box-shadow:0 10px 30px rgba(0,0,0,0.5)}
.sug{padding:10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px}
.sug:hover{background:var(--card2)}

.workspace{flex:1;display:flex;overflow:hidden}
.sidebar{width:360px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sidebar-head{padding:15px;border-bottom:1px solid var(--border)}
.tlist{flex:1;overflow-y:auto;padding:8px}

.detail{flex:1;background:var(--bg);overflow-y:auto;padding:25px;display:flex;flex-direction:column}
.tabs{display:flex;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0}
.tab{padding:14px 20px;font-size:11px;font-weight:700;text-transform:uppercase;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;transition:0.2s}
.tab.active{color:var(--blue2);border-bottom-color:var(--blue2)}

.view{display:none;flex:1}.view.active{display:block}

.tcard{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--blue);border-radius:6px;padding:14px;margin-bottom:8px;cursor:pointer;transition:0.1s}
.tcard:hover{border-color:var(--blue2);background:var(--card2);transform:translateX(2px)}
.tcard.sel{background:var(--card2);border-left-width:6px;border-color:var(--blue2)}

.kpis{display:flex;gap:10px;margin-top:12px}
.kpi{flex:1;background:var(--card);padding:10px;border-radius:8px;text-align:center;border:1px solid var(--border)}
.kpi-v{font-family:"JetBrains Mono",monospace;font-size:20px;font-weight:700}
.kpi-l{font-size:10px;color:var(--muted);text-transform:uppercase;margin-top:2px}

.timeline{border-left:2px solid var(--border);margin-left:25px;padding-left:25px;margin-top:20px}
.stop-row{margin-bottom:25px;position:relative}
.stop-row::before{content:'';position:absolute;left:-31px;top:5px;width:10px;height:10px;background:var(--blue);border:2px solid var(--bg);border-radius:50%}
.stop-time{font-family:"JetBrains Mono",monospace;color:var(--green);font-size:15px;margin-right:12px}

@keyframes spin{to{transform:rotate(360deg)}}
.loader{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin 1s linear infinite;margin:20px auto}
</style>
</head>
<body>

<div class="topbar">
  <div class="brand">🚄 SNCF OPS CENTER</div>
  <div class="search-wrap">
    <input type="text" id="search" placeholder="Rechercher une gare d'observation..." autocomplete="off">
    <div class="sugg" id="sugg"></div>
  </div>
  <div class="clock" id="clock">00:00:00</div>
</div>

<div class="tabs">
  <div class="tab active" data-v="departures" onclick="switchTab(this)">Départs</div>
  <div class="tab" data-v="arrivals" onclick="switchTab(this)">Arrivées</div>
  <div class="tab" data-v="train" onclick="switchTab(this)">Suivi Train</div>
  <div class="tab" data-v="alerts" onclick="switchTab(this)">Alertes</div>
</div>

<div class="workspace">
  <div class="sidebar">
    <div class="sidebar-head">
      <div id="gare-name" style="font-weight:700;font-size:16px;color:var(--blue2)">📍 Aucune sélection</div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-v" id="kpi-total">0</div><div class="kpi-l">Total</div></div>
        <div class="kpi" style="color:var(--green)"><div class="kpi-v" id="kpi-ok">0</div><div class="kpi-l">OK</div></div>
        <div class="kpi" style="color:var(--orange)"><div class="kpi-v" id="kpi-late">0</div><div class="kpi-l">Retards</div></div>
      </div>
    </div>
    <div class="tlist" id="tlist">
      <div style="padding:50px 20px;text-align:center;color:var(--muted);font-size:14px">Saisissez une ville ou une gare.</div>
    </div>
  </div>
  <div class="detail">
    <div id="view-departures" class="view active">
      <div style="text-align:center;margin-top:150px;color:var(--muted)">Aucun train sélectionné.</div>
    </div>
    <div id="view-arrivals" class="view">
      <div style="text-align:center;margin-top:150px;color:var(--muted)">Cliquez sur l'onglet pour voir les arrivées.</div>
    </div>
    <div id="view-train" class="view">
      <div style="text-align:center;margin-top:150px;color:var(--muted)">Sélectionnez un train dans la liste de gauche.</div>
    </div>
    <div id="view-alerts" class="view"><div class="loader"></div></div>
  </div>
</div>

<script>
let G = { stop: null };

setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleTimeString('fr-FR'); }, 1000);

const searchInput = document.getElementById('search');
const suggBox = document.getElementById('sugg');

searchInput.addEventListener('input', function(e) {
  const q = e.target.value;
  if(q.length < 2) return suggBox.style.display = 'none';
  
  fetch('/api/places?q=' + encodeURIComponent(q))
    .then(r => r.json())
    .then(data => {
      const places = data.places || [];
      suggBox.innerHTML = places.map(p => 
        \`<div class="sug" onclick="selectGare('\${p.id}', '\${p.name.replace(/'/g, "\\\\'")}')">
          <strong>\${p.name}</strong><br>
          <small style="color:var(--muted)">\${p.administrative_regions?.[0]?.name || ''}</small>
        </div>\`
      ).join('');
      suggBox.style.display = 'block';
    });
});

function selectGare(id, name) {
  G.stop = id;
  suggBox.style.display = 'none';
  searchInput.value = name;
  document.getElementById('gare-name').textContent = '📍 ' + name;
  loadData('departures');
}

function loadData(type) {
  if(!G.stop) return;
  const list = document.getElementById('tlist');
  list.innerHTML = '<div class="loader"></div>';

  fetch('/api/' + type + '?stop=' + encodeURIComponent(G.stop))
    .then(r => r.json())
    .then(data => {
      const items = data[type] || [];
      document.getElementById('kpi-total').textContent = items.length;
      document.getElementById('kpi-ok').textContent = items.filter(i => (i.stop_date_time.departure_delay || 0) === 0).length;
      document.getElementById('kpi-late').textContent = items.filter(i => (i.stop_date_time.departure_delay || 0) > 0).length;

      list.innerHTML = items.map(item => {
        const info = item.display_informations;
        const dt = item.stop_date_time;
        const timeStr = (dt.departure_date_time || dt.arrival_date_time).slice(9,14).replace('T','');
        const vjId = item.links.find(l => l.type === 'vehicle_journey')?.id;
        
        return \`<div class="tcard" onclick="trackTrain('\${vjId}', '\${info.headsign}')">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;color:var(--blue2)">\${info.commercial_mode} \${info.headsign}</span>
            <span style="font-family:monospace;font-size:16px">\${timeStr.slice(0,2)}:\${timeStr.slice(2,4)}</span>
          </div>
          <div style="font-size:12px;margin-top:4px;color:#88a">Vers \${info.direction.split('(')[0]}</div>
        </div>\`;
      }).join('');
    });
}

function trackTrain(vjId, headsign) {
  if(!vjId) return;
  const tabs = document.querySelectorAll('.tab');
  switchTab(tabs[2]);

  const area = document.getElementById('view-train');
  area.innerHTML = '<div class="loader"></div>';

  fetch('/api/vehicle?id=' + encodeURIComponent(vjId))
    .then(r => r.json())
    .then(data => {
      const vj = data.vehicle_journeys[0];
      area.innerHTML = \`<h2 style="margin-bottom:20px;color:var(--blue2)">Train \${headsign}</h2><div class="timeline">\` + 
        vj.stop_times.map(st => \`<div class="stop-row"><span class="stop-time">\${st.arrival_time.slice(0,2)}:\${st.arrival_time.slice(2,4)}</span><strong>\${st.stop_point.name}</strong></div>\`).join('') + 
        '</div>';
    });
}

function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('view-' + el.dataset.v).classList.add('active');
  if(el.dataset.v === 'arrivals') loadData('arrivals');
  if(el.dataset.v === 'departures') loadData('departures');
  if(el.dataset.v === 'alerts') loadAlerts();
}

function loadAlerts() {
  const area = document.getElementById('view-alerts');
  fetch('/api/disruptions').then(r => r.json()).then(data => {
    const alerts = data.disruptions || [];
    area.innerHTML = '<h2>Alertes Réseau</h2>' + alerts.map(a => \`<div style="background:var(--card);padding:15px;border-radius:8px;border-left:4px solid var(--orange);margin-bottom:12px"><strong>\${a.cause || 'Perturbation'}</strong><br>\${a.messages?.[0]?.text || ''}</div>\`).join('');
  });
}
loadAlerts();
</script>
</body>
</html>\`;
