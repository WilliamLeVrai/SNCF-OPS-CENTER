#!/usr/bin/env node
/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * SNCF OPS CENTER — FULL OPERATIONAL ENGINE (V5)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT     = process.env.PORT || 10000;
const BASE_URL = "api.sncf.com";
const BASE_PATH = "/v1/coverage/sncf/";

if (!API_KEY) {
  console.error("\n❌ Erreur : Variable SNCF_API_KEY manquante.");
  process.exit(1);
}

// --- CACHE AVANCÉ ---
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

// --- ENGINE RÉSEAU ---
function sncfGet(path, ttlKey) {
  const cached = cacheGet(path);
  if (cached) { stats.cached++; return Promise.resolve(cached); }
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
        } catch(e) { reject(new Error("Erreur JSON API")); }
      });
    }).on("error", e => { stats.errors++; reject(e); });
  });
}

function nowNavitia() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return n.getFullYear() + p(n.getMonth()+1) + p(n.getDate()) + "T" + p(n.getHours()) + p(n.getMinutes()) + "00";
}

// --- ROUTAGE SERVEUR ---
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
    let data;
    const dt = nowNavitia();

    if (path === "/api/places") {
      data = await sncfGet("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area&count=15", "places");
    } else if (path === "/api/departures") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?from_datetime=" + dt + "&count=50&data_freshness=base_schedule", "departures");
    } else if (path === "/api/arrivals") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?from_datetime=" + dt + "&count=50&data_freshness=base_schedule", "arrivals");
    } else if (path === "/api/vehicle") {
      data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=base_schedule", "vehicle");
    } else if (path === "/api/disruptions") {
      data = await sncfGet("disruptions?count=50", "disruptions");
    } else if (path === "/api/stats") {
      data = { ...stats, cacheSize: cache.size, uptime: Math.round((Date.now() - stats.startTime) / 1000) };
    } else {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "404" }));
    }
    res.end(JSON.stringify(data));
  } catch (e) {
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("🚄 OPS CENTER READY ON " + PORT));
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>SNCF OPS CENTER - GLOBAL DASHBOARD</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #04070e; --panel: #070d18; --card: #0b1422; --card-hover: #121d2f;
            --border: #13253d; --border-focus: #1e3a5f; --text: #ccd9ee; --muted: #4a628a;
            --blue: #2f80ed; --blue-glow: rgba(47, 128, 237, 0.3);
            --green: #00e676; --orange: #ff9100; --red: #ff1744; --cyan: #00c2d4;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); color: var(--text); font-family: "DM Sans", sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

        .header { height: 60px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 20px; gap: 20px; z-index: 1000; }
        .logo { font-family: "Bebas Neue", sans-serif; font-size: 1.8rem; color: var(--blue); letter-spacing: 2px; }

        .search-container { position: relative; flex: 1; max-width: 450px; }
        .search-input { width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 15px; color: white; outline: none; transition: 0.2s; }
        .search-input:focus { border-color: var(--blue); box-shadow: 0 0 0 4px var(--blue-glow); }

        .suggestions { position: absolute; top: 110%; left: 0; right: 0; background: #0a1629; border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); display: none; overflow: hidden; z-index: 2000; }
        .suggestion-item { padding: 12px 15px; cursor: pointer; border-bottom: 1px solid var(--border); transition: 0.2s; }
        .suggestion-item:hover { background: var(--card-hover); }

        .wrapper { flex: 1; display: flex; overflow: hidden; }
        .sidebar { width: 380px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
        .main-content { flex: 1; overflow-y: auto; background: var(--bg); padding: 30px; }

        .nav-tabs { display: flex; background: var(--panel); border-bottom: 1px solid var(--border); }
        .nav-tab { padding: 15px 25px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); cursor: pointer; border-bottom: 3px solid transparent; }
        .nav-tab.active { color: var(--blue); border-bottom-color: var(--blue); background: rgba(47, 128, 237, 0.05); }

        .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 15px; border-bottom: 1px solid var(--border); }
        .kpi-card { background: var(--card); padding: 10px; border-radius: 8px; text-align: center; border: 1px solid var(--border); }
        .kpi-val { display: block; font-size: 1.4rem; font-weight: 700; font-family: "JetBrains Mono"; }
        .kpi-label { font-size: 0.6rem; color: var(--muted); text-transform: uppercase; }

        .train-card { background: var(--card); border: 1px solid var(--border); border-left: 4px solid var(--blue); border-radius: 8px; margin: 10px; padding: 15px; cursor: pointer; transition: 0.1s; }
        .train-card:hover { border-color: var(--blue); transform: translateX(4px); }
        .train-card.late { border-left-color: var(--orange); }

        .timeline { padding: 20px; border-left: 2px solid var(--border); margin-left: 20px; }
        .stop-point { margin-bottom: 30px; position: relative; }
        .stop-point::before { content: ''; position: absolute; left: -27px; top: 5px; width: 12px; height: 12px; background: var(--blue); border-radius: 50%; border: 3px solid var(--bg); }
        
        .spin { width: 30px; height: 30px; border: 3px solid var(--border); border-top-color: var(--blue); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 20px auto; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <header class="header">
        <div class="logo">SNCF OPS CENTER</div>
        <div class="search-container">
            <input type="text" id="search" class="search-input" placeholder="Gare d'observation (Béziers, Paris...)" autocomplete="off">
            <div id="suggestions" class="suggestions"></div>
        </div>
        <div id="clock" style="margin-left: auto; font-family: 'JetBrains Mono'; color: var(--cyan);">--:--:--</div>
    </header>

    <nav class="nav-tabs">
        <div class="nav-tab active" onclick="setMode('departures', this)">Départs</div>
        <div class="nav-tab" onclick="setMode('arrivals', this)">Arrivées</div>
        <div class="nav-tab" onclick="setMode('alerts', this)">Alertes</div>
    </nav>

    <div class="wrapper">
        <aside class="sidebar">
            <div class="kpi-grid">
                <div class="kpi-card"><span class="kpi-val" id="k-total">0</span><span class="kpi-label">TOTAL</span></div>
                <div class="kpi-card" style="color: var(--green);"><span class="kpi-val" id="k-ok">0</span><span class="kpi-label">OK</span></div>
                <div class="kpi-card" style="color: var(--orange);"><span class="kpi-val" id="k-late">0</span><span class="kpi-label">RETARDS</span></div>
            </div>
            <div id="train-list" style="overflow-y: auto; flex: 1; padding: 10px;"></div>
        </aside>
        <main class="main-content" id="main-view"></main>
    </div>
    <script>
        let currentGare = null;
        let currentMode = 'departures';

        setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleTimeString('fr-FR'); }, 1000);

        const searchInput = document.getElementById('search');
        const suggBox = document.getElementById('suggestions');

        // RECHERCHE AVEC FIX BÉZIERS & ACCENTS
        searchInput.addEventListener('input', async (e) => {
            const q = e.target.value;
            if (q.length < 2) { suggBox.style.display = 'none'; return; }

            const r = await fetch(\`/api/places?q=\${encodeURIComponent(q)}\`);
            const d = await r.json();
            const places = d.places || [];

            if (places.length > 0) {
                suggBox.innerHTML = places.map(p => {
                    // Fix mapping ID et protection des apostrophes
                    const safeName = p.name.replace(/'/g, "\\\\'");
                    return \`
                        <div class="suggestion-item" onclick="selectGare('\${p.id}', '\${safeName}')">
                            <strong>\${p.name}</strong><br>
                            <small style="color: var(--muted)">\${p.administrative_regions?.[0]?.name || ''}</small>
                        </div>
                    \`;
                }).join('');
                suggBox.style.display = 'block';
            }
        });

        function selectGare(id, name) {
            currentGare = id;
            suggBox.style.display = 'none';
            searchInput.value = name;
            loadTraffic();
        }

        function setMode(mode, el) {
            currentMode = mode;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            loadTraffic();
        }

        async function loadTraffic() {
            if (!currentGare) return;
            const list = document.getElementById('train-list');
            list.innerHTML = '<div class="spin"></div>';

            const r = await fetch(\`/api/\${currentMode}?stop=\${encodeURIComponent(currentGare)}\`);
            const d = await r.json();
            const items = d[currentMode] || [];

            document.getElementById('k-total').textContent = items.length;
            document.getElementById('k-ok').textContent = items.filter(i => (i.stop_date_time.departure_delay || 0) === 0).length;
            document.getElementById('k-late').textContent = items.filter(i => (i.stop_date_time.departure_delay || 0) > 0).length;

            list.innerHTML = items.map(item => {
                const info = item.display_informations;
                const dt = item.stop_date_time;
                const time = (dt.departure_date_time || dt.arrival_date_time).slice(9, 14).replace('T', ':');
                const delay = Math.round((dt.departure_delay || 0) / 60);
                const vjId = item.links.find(l => l.type === 'vehicle_journey')?.id;

                return \`
                    <div class="train-card \${delay > 0 ? 'late' : ''}" onclick="viewTrain('\${vjId}', '\${info.headsign}')">
                        <div style="display: flex; justify-content: space-between;">
                            <strong>\${info.commercial_mode} \${info.headsign}</strong>
                            <span class="time-badge">\${time}</span>
                        </div>
                        <div style="font-size: 0.8rem; color: var(--muted); margin-top: 5px;">→ \${info.direction.split('(')[0]}</div>
                        \${delay > 0 ? \`<div style="color: var(--orange); font-size: 0.7rem; font-weight: bold; margin-top: 5px;">+ \${delay} MIN RETARD</div>\` : ''}
                    </div>
                \`;
            }).join('');
        }

        async function viewTrain(vjId, headsign) {
            const main = document.getElementById('main-view');
            main.innerHTML = '<div class="spin"></div>';

            const r = await fetch(\`/api/vehicle?id=\${encodeURIComponent(vjId)}\`);
            const d = await r.json();
            const vj = d.vehicle_journeys[0];

            main.innerHTML = \`
                <h1 style="font-family: 'Bebas Neue'; font-size: 3rem; color: var(--blue);">TRAIN \${headsign}</h1>
                <p style="color: var(--muted); margin-bottom: 30px;">\${vj.display_informations.commercial_mode} | Direction \${vj.display_informations.direction}</p>
                <div class="timeline">
                    \${vj.stop_times.map(st => \`
                        <div class="stop-point">
                            <div style="font-weight: 700;">\${st.stop_point.name}</div>
                            <div style="font-family: 'JetBrains Mono'; color: var(--cyan);">\${(st.arrival_time || st.departure_time).slice(0, 5).replace(/(\\d{2})(\\d{2})/, '$1:$2')}</div>
                        </div>
                    \`).join('')}
                </div>
            \`;
        }
    </script>
</body>
</html>\`;
