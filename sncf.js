#!/usr/bin/env node
const http = require("http");
const https = require("https");
const url = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT = process.env.PORT || 10000;

if (!API_KEY) {
  console.error("❌ Erreur: Clé API manquante");
  process.exit(1);
}

function sncfGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.sncf.com",
      path: "/v1/coverage/sncf/" + path,
      headers: { Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64") }
    };
    https.get(opts, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    }).on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const q = parsed.query;
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML);
    return;
  }

  res.setHeader("Content-Type", "application/json");
  try {
    let data;
    if (path === "/api/places") data = await sncfGet("places?q=" + encodeURIComponent(q.q) + "&type[]=stop_area");
    else if (path === "/api/departures") data = await sncfGet("stop_areas/" + encodeURIComponent(q.stop) + "/departures?data_freshness=base_schedule");
    else if (path === "/api/vehicle") data = await sncfGet("vehicle_journeys/" + encodeURIComponent(q.id));
    else return res.end(JSON.stringify({error: "404"}));
    res.end(JSON.stringify(data));
  } catch(e) { res.end(JSON.stringify({error: e.message})); }
});

server.listen(PORT, "0.0.0.0", () => console.log("🚄 OPS READY ON " + PORT));

const HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SNCF OPS</title>
    <style>
        body{background:#04070e;color:#ccd9ee;font-family:sans-serif;margin:0;display:flex;flex-direction:column;height:100vh}
        .bar{background:#070d18;padding:15px;display:flex;gap:20px;border-bottom:1px solid #13253d}
        input{background:#0b1422;border:1px solid #1a3354;padding:10px;color:white;flex:1;border-radius:5px}
        .sugg{position:absolute;top:55px;background:#0a1525;border:1px solid #1a3354;width:300px;display:none;z-index:10}
        .sug{padding:10px;cursor:pointer;border-bottom:1px solid #13253d}
        .main{display:flex;flex:1;overflow:hidden}
        .side{width:350px;background:#070d18;border-right:1px solid #13253d;overflow-y:auto;padding:10px}
        .card{background:#0b1422;padding:15px;margin-bottom:10px;border-left:4px solid #2f80ed;border-radius:4px;cursor:pointer}
        .det{flex:1;padding:20px;overflow-y:auto}
    </style>
</head>
<body>
    <div class="bar">
        <div style="font-weight:bold;color:#2f80ed">🚄 SNCF OPS</div>
        <div style="position:relative;flex:1;max-width:400px">
            <input type="text" id="search" placeholder="Gare (ex: Paris, Beziers)...">
            <div class="sugg" id="sugg"></div>
        </div>
    </div>
    <div class="main">
        <div class="side" id="list"></div>
        <div class="det" id="det">Selectionnez un train</div>
    </div>
    <script>
        const s = document.getElementById('search');
        const sug = document.getElementById('sugg');
        s.addEventListener('input', () => {
            if(s.value.length < 2) return;
            fetch('/api/places?q='+encodeURIComponent(s.value)).then(r=>r.json()).then(d=>{
                sug.innerHTML = (d.places||[]).map(p=>\`<div class="sug" onclick="sel('\${p.id}','\${p.name}')">\${p.name}</div>\`).join('');
                sug.style.display = 'block';
            });
        });
        function sel(id, n) {
            s.value = n; sug.style.display = 'none';
            document.getElementById('list').innerHTML = 'Chargement...';
            fetch('/api/departures?stop='+encodeURIComponent(id)).then(r=>r.json()).then(d=>{
                document.getElementById('list').innerHTML = (d.departures||[]).map(t=>\`
                    <div class="card" onclick="track('\${t.links.find(l=>l.type==='vehicle_journey').id}')">
                        <strong>\${t.display_informations.headsign}</strong> (\${t.stop_date_time.departure_date_time.slice(9,14)})<br>
                        <small>Vers \${t.display_informations.direction}</small>
                    </div>\`).join('');
            });
        }
        function track(id) {
            document.getElementById('det').innerHTML = 'Chargement...';
            fetch('/api/vehicle?id='+encodeURIComponent(id)).then(r=>r.json()).then(d=>{
                const v = d.vehicle_journeys[0];
                document.getElementById('det').innerHTML = '<h2>Train '+v.display_informations.headsign+'</h2>' + 
                    v.stop_times.map(st=>'<div>'+st.arrival_time.slice(0,5)+' - '+st.stop_point.name+'</div>').join('');
            });
        }
    </script>
</body>
</html>\`;
