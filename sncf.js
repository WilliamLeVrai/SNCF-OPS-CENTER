#!/usr/bin/env node
const http  = require("http");
const https = require("https");
const url   = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT     = process.env.PORT || 10000;
const BASE_URL = "api.sncf.com";
const BASE_PATH = "/v1/coverage/sncf/";

if (!API_KEY) {
  console.error("\n❌ Erreur: Manque SNCF_API_KEY");
  process.exit(1);
}

const stats = { total: 0, cached: 0, api: 0, errors: 0, startTime: Date.now() };

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
    } else if (path === "/api/departures") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?count=40&data_freshness=base_schedule");
    } else if (path === "/api/arrivals") {
      data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/arrivals?count=40&data_freshness=base_schedule");
    } else if (path === "/api/vehicle") {
      data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id) + "?data_freshness=base_schedule");
    } else {
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
  console.log("🚄 Serveur pret sur port " + PORT);
});

const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>SNCF OPS CENTER</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root{--bg:#04070e;--panel:#070d18;--card:#0b1422;--text:#ccd9ee;--blue:#2f80ed;--muted:#3d5475;--green:#00e676;}
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
            <input type="text" id="search" placeholder="Recherche (ex: Paris, Beziers)..." autocomplete="off">
            <div class="sugg" id="sugg"></div>
        </div>
    </div>
    <div class="vtab-bar">
        <div class="vtab active" onclick="tab('departures', this)">Departs</div>
        <div class="vtab" onclick="tab('arrivals', this)">Arrivees</div>
    </div>
    <div class="main">
        <div class="sidebar" id="list"></div>
        <div class="view-area" id="detail">Selectionnez un train</div>
    </div>
    <script>
        let currentGare = null;
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
            const list = document.getElementById('list');
            list.innerHTML = 'Chargement...';
            fetch('/api/' + type + '?stop=' + encodeURIComponent(currentGare))
                .then(r => r.json())
                .then(data => {
                    const items = data[type] || [];
                    list.innerHTML = items.map(item => {
                        const info = item.display_informations;
                        const time = item.stop_date_time.departure_date_time || item.stop_date_time.arrival_date_time;
                        return \`<div class="tcard" onclick="track('\${item.links.find(l=>l.type==='vehicle_journey')?.id}')">
                            <strong>\${info.headsign}</strong> (\${time.slice(9,11)}:\${time.slice(11,13)})<br>
                            <small>\${info.direction.split('(')[0]}</small>
                        </div>\`;
                    }).join('');
                });
        }

        function track(id) {
            if(!id) return;
            const area = document.getElementById('detail');
            area.innerHTML = 'Chargement...';
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
            el.classList.add('active');
            load(t);
        }
    </script>
</body>
</html>\`;
