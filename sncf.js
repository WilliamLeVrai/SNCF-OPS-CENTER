#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNCF OPS CENTER — Version Finale Corrigée
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT     = process.env.PORT || 10000;
const BASE_URL = "api.sncf.com";
const BASE_PATH = "/v1/coverage/sncf/";

if (!API_KEY) {
  console.error("\n❌ Clé API manquante dans les variables d'environnement !");
  process.exit(1);
}

const stats = { total: 0, cached: 0, api: 0, errors: 0, startTime: Date.now() };

// --- FONCTION API ---
function sncfGet(path) {
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
        try { resolve(JSON.parse(raw)); } catch(e) { reject(e); }
      });
    }).on("error", e => { stats.errors++; reject(e); });
  });
}

// --- SERVEUR ---
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

  try {
    let data;
    if (path === "/api/places") {
      data = await sncfGet("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area&count=8");
    }
    else if (path === "/api/departures") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?count=40&data_freshness=base_schedule");
    }
    else if (path === "/api/arrivals") {
        data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?count=40&data_freshness=base_schedule");
    }
    else if (path === "/api/vehicle") {
      data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=base_schedule");
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
  console.log("🚄 Serveur pret sur le port " + PORT);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERFACE HTML (CORRIGÉE SANS ACCENTS DANS LE CODE)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNCF OPS CENTER</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#04070e;--panel:#070d18;--card:#0b1422;--text:#ccd9ee;--blue:#2f80ed;--muted:#3d5475;}
body{background:var(--bg);color:var(--text);font-family:"DM Sans",sans-serif;margin:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.topbar{height:60px;background:var(--panel);display:flex;align-items:center;padding:0 20px;gap:20px;border-bottom:1px solid #13253d}
.search-wrap{position:relative;flex:1;max-width:400px}
input{width:100%;background:var(--card);border:1px solid #1a3354;padding:10px;color:white;border-radius:5px;outline:none}
.sugg{position:absolute;top:100%;left:0;right:0;background:#0a1525;border:1px solid #1a3354;display:none;z-index:1000}
.sug{padding:10px;cursor:pointer;border-bottom:1px solid #13253d}.sug:hover{background:#112038}
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:350px;background:var(--panel);border-right:1px solid #13253d;overflow-y:auto;padding:10px}
.view-area{flex:1;padding:20px;overflow-y:auto}
.tcard{background:var(--card);padding:15px;margin-bottom:10px;border-left:4px solid var(--blue);border-radius:4px;cursor:pointer}
.vtab-bar{display:flex;background:var(--panel);border-bottom:1px solid #13253d}
.vtab{padding:15px;cursor:pointer;font-size:12px;text-transform:uppercase;color:var(--muted)}
.vtab.active{color:var(--blue);border-bottom:2px solid var(--blue)}
.view{display:none}.view.active{display:block}
</style>
</head>
<body>

<div class="topbar">
  <div style="font-weight:bold;color:var(--blue)">🚄 SNCF OPS</div>
  <div class="search-wrap">
    <input type="text" id="search" placeholder="Chercher une gare (ex: Paris, Beziers)..." autocomplete="off">
    <div class="sugg" id="sugg"></div>
  </div>
</div>

<div class="vtab-bar">
  <div class="vtab active" onclick="tab('departures', this)">Départs</div>
  <div class="vtab" onclick="tab('arrivals', this)">Arrivées</div>
  <div class="vtab" onclick="tab('train', this)">Suivi Train</div>
</div>

<div class="main">
  <div class="sidebar" id="list">
    <div style="text-align:center;margin-top:50px;color:var(--muted)">Recherchez une gare ci-dessus</div>
  </div>
  <div class="view-area">
    <div id="v-departures" class="view active">Sélectionnez un train dans la liste</div>
    <div id="v-arrivals" class="view">Sélectionnez une gare pour voir les arrivées</div>
    <div id="v-train" class="view">Détails du trajet sélectionnés</div>
  </div>
</div>

<script>
let currentGare = null;

// Recherche
document.getElementById('search').addEventListener('input', function(e) {
  if(e.target.value.length < 2) return;
  fetch('/api/places?q=' + encodeURIComponent(e.target.value))
    .then(r => r.json())
    .then(data => {
      const raw = data.places || [];
      document.getElementById('sugg').innerHTML = raw.map(p => 
        \`<div class="sug" onclick="sel('\${p.id}', '\${p.name.replace(/'/g, "\\\\'")}')">\${p.name}</div>\`
      ).join('');
      document.getElementById('sugg').style.display = 'block';
    });
});

function sel(id, name) {
  currentGare = id;
  document.getElementById('sugg').style.display = 'none';
  document.getElementById('search').value = name;
  load('departures');
}

function load(type) {
  if(!currentGare) return;
  const list = document.getElementById('list');
  list.innerHTML = 'Chargement...';
  fetch('/api/' + type + '?stop=' + encodeURIComponent(currentGare))
    .then(r => r.json())
    .then(data => {
      const items = data[type] || [];
      list.innerHTML = items.map(item => {
        const info = item.display_informations;
        const time = item.stop_date_time.departure_date_time || item.stop_date_time.arrival_date_time;
        const idVj = item.links.find(l => l.type === 'vehicle_journey')?.id;
        return \`<div class="tcard" onclick="track('\${idVj}')">
          <strong>\${info.headsign}</strong> (\${time.slice(9,11)}:\${time.slice(11,13)})<br>
          <small>Vers \${info.direction.split('(')[0]}</small>
        </div>\`;
      }).join('');
    });
}

function track(id) {
  if(!id) return;
  tab('train', document.querySelectorAll('.vtab')[2]);
  const area = document.getElementById('v-train');
  area.innerHTML = 'Chargement du trajet...';
  fetch('/api/vehicle?id=' + encodeURIComponent(id))
    .then(r => r.json())
    .then(data => {
      const vj = data.vehicle_journeys[0];
      area.innerHTML = \`<h2>Train \${vj.display_informations.headsign}</h2>\` + 
        vj.stop_times.map(s => \`<div>\${s.arrival_time.slice(0,2)}:\${s.arrival_time.slice(2,4)} - \${s.stop_point.name}</div>\`).join('');
    });
}

function tab(t, el) {
  document.querySelectorAll('.vtab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('v-' + t).classList.add('active');
  if(t === 'arrivals') load('arrivals');
  if(t === 'departures') load('departures');
}
</script>
</body>
</html>\`;
