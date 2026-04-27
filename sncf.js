#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SNCF OPS CENTER — SECTION 1/3 (SERVEUR & BASE CSS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const http = require("http");
const https = require("https");
const url = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT = process.env.PORT || 10000;
const BASE_URL = "api.sncf.com";
const BASE_PATH = "/v1/coverage/sncf/";

if (!API_KEY) {
  console.error("\n❌ Clé API manquante !");
  process.exit(1);
}

const cache = new Map();
const CACHE_TTL = {
  places: 300000, departures: 20000, arrivals: 20000, vehicle: 30000,
  disruptions: 60000, traffic: 60000, schedules: 20000, lines: 600000, journeys: 120000
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

function sncfGet(path, ttlKey) {
  const cached = cacheGet(path);
  if (cached) { stats.cached++; return Promise.resolve(cached); }
  stats.api++;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE_URL, path: BASE_PATH + path,
      headers: { Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64"), Accept: "application/json" }
    };
    https.get(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try {
          const data = JSON.parse(raw);
          cacheSet(path, data, CACHE_TTL[ttlKey] || 30000);
          resolve(data);
        } catch(e) { reject(new Error("JSON API Invalide")); }
      });
    }).on("error", e => { stats.errors++; reject(e); });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const q = parsed.query;
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(HTML);
  }
  res.setHeader("Content-Type", "application/json");
  try {
    let data; const dt = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    if (path === "/api/places") data = await sncfGet("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area&count=12", "places");
    else if (path === "/api/departures") data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?from_datetime=" + dt + "&count=50&data_freshness=base_schedule&depth=2", "departures");
    else if (path === "/api/arrivals") data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?from_datetime=" + dt + "&count=50&data_freshness=base_schedule&depth=2", "arrivals");
    else if (path === "/api/vehicle") data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=base_schedule", "vehicle");
    else if (path === "/api/disruptions") data = await sncfGet("disruptions?count=50", "disruptions");
    else if (path === "/api/stats") data = { ...stats, cacheSize: cache.size, uptime: Math.round((Date.now() - stats.startTime) / 1000) };
    res.end(JSON.stringify(data));
  } catch(e) { res.end(JSON.stringify({error: e.message})); }
});

server.listen(PORT, "0.0.0.0", () => console.log("🚄 OPS CENTER READY ON " + PORT));

const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>SNCF OPS CENTER</title>
<style>
:root{--bg:#04070e;--panel:#070d18;--card:#0b1422;--border:#13253d;--text:#ccd9ee;--blue:#2f80ed;--green:#00e676;--orange:#ff9100;--red:#ff1744;}
body{background:var(--bg);color:var(--text);font-family:sans-serif;margin:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.topbar{height:52px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:20px}
.search-wrap{position:relative;flex:1;max-width:400px}
input{width:100%;background:var(--card);border:1px solid #1a3354;padding:10px;color:white;border-radius:8px;outline:none}
.sugg{position:absolute;top:100%;left:0;right:0;background:#0a1525;border:1px solid #1a3354;display:none;z-index:1000}
.sug{padding:12px;cursor:pointer;border-bottom:1px solid var(--border)}.sug:hover{background:#112038}
.workspace{flex:1;display:flex;overflow:hidden}
.sidebar{width:360px;background:var(--panel);border-right:1px solid var(--border);overflow-y:auto}
.detail{flex:1;padding:25px;overflow-y:auto}
.tcard{background:var(--card);padding:15px;margin:10px;border-left:4px solid var(--blue);border-radius:6px;cursor:pointer}
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:15px}
.kpi{background:var(--card);padding:10px;border-radius:8px;text-align:center;border:1px solid var(--border)}
.timeline{border-left:2px solid var(--border);margin-left:20px;padding-left:20px}
.stop-row{margin-bottom:20px;position:relative}
.stop-row::before{content:'';position:absolute;left:-26px;top:5px;width:10px;height:10px;background:var(--blue);border-radius:50%}
</style>
</head>
<body>
<div class="topbar">
    <div class="brand">🚄 SNCF OPS CENTER</div>
    <div class="search-wrap">
        <input type="text" id="search" placeholder="Rechercher une gare..." autocomplete="off">
        <div class="sugg" id="sugg"></div>
    </div>
    <div id="clock" style="font-family:monospace; color:var(--cyan)">--:--:--</div>
</div>

<div class="tabs">
    <div class="tab active" data-v="departures" onclick="switchTab(this)">Départs</div>
    <div class="tab" data-v="arrivals" onclick="switchTab(this)">Arrivées</div>
    <div class="tab" data-v="train" onclick="switchTab(this)">Suivi Train</div>
    <div class="tab" data-v="alerts" onclick="switchTab(this)">Alertes</div>
</div>

<div class="workspace">
    <aside class="sidebar">
        <div class="sidebar-head">
            <div id="gare-name" style="font-weight:700; margin-bottom:10px">📍 Aucune sélection</div>
            <div class="kpi-grid">
                <div class="kpi"><div id="kpi-total" style="font-weight:700">0</div><div style="font-size:9px">TOTAL</div></div>
                <div class="kpi" style="color:var(--green)"><div id="kpi-ok" style="font-weight:700">0</div><div style="font-size:9px">OK</div></div>
                <div class="kpi" style="color:var(--orange)"><div id="kpi-late" style="font-weight:700">0</div><div style="font-size:9px">RETARD</div></div>
            </div>
        </div>
        <div class="tlist" id="tlist">
            <div style="padding:40px; text-align:center; color:var(--muted)">Saisissez une gare en haut à gauche.</div>
        </div>
    </aside>

    <main class="detail">
        <div id="view-departures" class="view active">
            <div style="text-align:center; margin-top:100px; color:var(--muted)">Tableau opérationnel des départs.</div>
        </div>
        <div id="view-arrivals" class="view">
            <div style="text-align:center; margin-top:100px; color:var(--muted)">Tableau opérationnel des arrivées.</div>
        </div>
        <div id="view-train" class="view">
            <div style="text-align:center; margin-top:100px; color:var(--muted)">Sélectionnez un train à gauche pour voir son itinéraire complet.</div>
        </div>
        <div id="view-alerts" class="view">
            <div id="alerts-list"></div>
        </div>
    </main>
</div>

<script>
let G = { stop: null, refresh: null };

// Horloge temps réel
setInterval(() => { 
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('fr-FR'); 
}, 1000);

// GESTION DE LA RECHERCHE (Correctif Béziers / Apostrophes)
const searchInput = document.getElementById('search');
const suggBox = document.getElementById('sugg');

searchInput.addEventListener('input', function(e) {
    const q = e.target.value;
    if(q.length < 2) {
        suggBox.style.display = 'none';
        return;
    }
    
    fetch('/api/places?q=' + encodeURIComponent(q))
        .then(r => r.json())
        .then(data => {
            const places = data.places || [];
            if(places.length === 0) {
                suggBox.style.display = 'none';
                return;
            }
            // Utilisation de p.id et p.name pour éviter les erreurs de mapping
            suggBox.innerHTML = places.map(p => {
                const safeName = p.name.replace(/'/g, "\\'");
                return `<div class="sug" onclick="selectGare('${p.id}', '${safeName}')">
                    <strong>${p.name}</strong><br>
                    <small style="color:var(--muted)">${p.administrative_regions?.[0]?.name || ''}</small>
                </div>`;
            }).join('');
            suggBox.style.display = 'block';
        })
        .catch(err => console.error("Erreur recherche:", err));
});

function selectGare(id, name) {
    G.stop = id;
    suggBox.style.display = 'none';
    searchInput.value = name;
    document.getElementById('gare-name').textContent = '📍 ' + name;
    loadTraffic('departures');
    
    // Auto-refresh toutes les 30 secondes
    if(G.refresh) clearInterval(G.refresh);
    G.refresh = setInterval(() => { loadTraffic('departures'); }, 30000);
}
// --- LOGIQUE D'AFFICHAGE DU TRAFIC ---
async function loadTraffic(type) {
    if (!G.stop) return;
    const listEl = document.getElementById('tlist');
    listEl.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spin-lg"></div><br>Chargement...</div>';

    try {
        const r = await fetch(`/api/${type}?stop=${encodeURIComponent(G.stop)}`);
        const d = await r.json();
        const items = d[type] || [];

        // Mise à jour des compteurs KPIs
        document.getElementById('kpi-total').textContent = items.length;
        document.getElementById('kpi-ok').textContent = items.filter(i => (i.stop_date_time.departure_delay || 0) === 0).length;
        document.getElementById('kpi-late').textContent = items.filter(i => (i.stop_date_time.departure_delay || 0) > 0).length;

        if (items.length === 0) {
            listEl.innerHTML = '<div style="padding:40px; text-align:center; color:var(--muted)">Aucun train trouvé pour cette période.</div>';
            return;
        }

        listEl.innerHTML = items.map((item, index) => {
            const info = item.display_informations;
            const dt = item.stop_date_time;
            const timeRaw = (dt.departure_date_time || dt.arrival_date_time).slice(9, 14);
            const time = timeRaw.replace('T', '');
            const delay = Math.round((dt.departure_delay || 0) / 60);
            const vjId = item.links.find(l => l.type === 'vehicle_journey')?.id;

            return `
                <div class="tcard" onclick="viewTrainDetails('${vjId}', '${info.headsign}')">
                    <div style="display:flex; justify-content:space-between; align-items:center">
                        <strong style="color:var(--blue2)">${info.commercial_mode} ${info.headsign}</strong>
                        <span style="font-family:monospace; font-size:1.1rem">${time.slice(0,2)}:${time.slice(2,4)}</span>
                    </div>
                    <div style="font-size:12px; margin-top:5px; color:#88a">Vers ${info.direction.split('(')[0]}</div>
                    <div style="margin-top:8px; display:flex; gap:10px">
                        ${dt.platform_code ? `<span class="voie">VOIE ${dt.platform_code}</span>` : ''}
                        ${delay > 0 ? `<span style="color:var(--orange); font-weight:bold">+${delay} min</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        listEl.innerHTML = '<div style="padding:40px; color:var(--red);">Erreur lors du chargement des données.</div>';
    }
}

// --- AFFICHAGE DU TRAJET DÉTAILLÉ (VIEW TRAIN) ---
async function viewTrainDetails(vjId, headsign) {
    if (!vjId) return;
    
    // Switch automatique vers l'onglet Suivi
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('.tab[data-v="train"]').classList.add('active');
    document.getElementById('view-train').classList.add('active');

    const area = document.getElementById('view-train');
    area.innerHTML = '<div style="padding:50px; text-align:center;"><div class="spin-lg"></div><br>Récupération du trajet...</div>';

    try {
        const r = await fetch(`/api/vehicle?id=${encodeURIComponent(vjId)}`);
        const d = await r.json();
        const vj = d.vehicle_journeys[0];
        const stops = vj.stop_times || [];

        area.innerHTML = `
            <div style="margin-bottom:30px">
                <h1 style="font-family:'Bebas Neue'; font-size:2.5rem; color:var(--blue)">TRAIN ${headsign}</h1>
                <p style="color:var(--muted)">Mode : ${vj.display_informations.commercial_mode} | Direction : ${vj.display_informations.direction}</p>
            </div>
            <div class="timeline">
                ${stops.map(st => {
                    const stTime = (st.arrival_time || st.departure_time);
                    return `
                        <div class="stop-row">
                            <span class="tl-time">${stTime.slice(0,2)}:${stTime.slice(2,4)}</span>
                            <strong>${st.stop_point.name}</strong>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (e) {
        area.innerHTML = '<div style="padding:40px; color:var(--red);">Impossible de charger les détails de ce train.</div>';
    }
}

// --- NAVIGATION ---
function switchTab(el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    el.classList.add('active');
    const target = 'view-' + el.dataset.v;
    document.getElementById(target).classList.add('active');
    
    if (el.dataset.v === 'alerts') loadAlerts();
}

async function loadAlerts() {
    const area = document.getElementById('alerts-list');
    area.innerHTML = '<div class="spin-lg"></div>';
    try {
        const r = await fetch('/api/disruptions');
        const d = await r.json();
        const alerts = d.disruptions || [];
        
        area.innerHTML = '<h2 style="margin-bottom:20px">Alertes Trafic Réseau</h2>' + 
            (alerts.length > 0 ? alerts.map(a => `
                <div style="background:var(--card); padding:15px; border-radius:8px; border-left:4px solid var(--orange); margin-bottom:12px">
                    <strong style="color:var(--orange)">${a.cause || 'Perturbation'}</strong><br>
                    <small style="line-height:1.5">${a.messages?.[0]?.text || 'Aucune description disponible.'}</small>
                </div>
            `).join('') : '<p>Aucune perturbation majeure signalée.</p>');
    } catch (e) {
        area.innerHTML = '<p>Erreur lors de la récupération des alertes.</p>';
    }
}

// Initialisation au chargement
loadAlerts();
</script>
</body>
</html>
\`;
