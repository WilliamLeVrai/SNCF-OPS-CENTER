#!/usr/bin/env node
const http = require("http");
const https = require("https");
const url = require("url");

const API_KEY = process.env.SNCF_API_KEY || process.env.SNCF_KEY || process.argv[2];
const PORT = process.env.PORT || 10000;

if (!API_KEY) { console.error("API_KEY manquante"); process.exit(1); }

async function sncf(path) {
  return new Promise((res, rej) => {
    const opts = {
      hostname: "api.sncf.com",
      path: "/v1/coverage/sncf/" + path,
      headers: { Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64") }
    };
    https.get(opts, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } });
    }).on("error", rej);
  });
}

const server = http.createServer(async (req, res) => {
  const p = url.parse(req.url, true);
  if (p.pathname === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(HTML);
  }
  res.setHeader("Content-Type", "application/json");
  try {
    let out;
    if (p.pathname === "/api/places") out = await sncf("places?q=" + encodeURIComponent(p.query.q));
    else if (p.pathname === "/api/departures") out = await sncf("stop_areas/" + p.query.stop + "/departures?data_freshness=base_schedule");
    else if (p.pathname === "/api/vehicle") out = await sncf("vehicle_journeys/" + p.query.id);
    res.end(JSON.stringify(out));
  } catch (e) { res.end(JSON.stringify({ error: e.message })); }
});

server.listen(PORT, "0.0.0.0", () => console.log("LIVE ON " + PORT));

const HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SNCF OPS</title><style>
body{background:#04070e;color:#ccd9ee;font-family:sans-serif;margin:0;display:flex;height:100vh}
.side{width:300px;background:#070d18;border-right:1px solid #13253d;padding:15px;overflow-y:auto}
.main{flex:1;padding:20px;overflow-y:auto}
input{width:100%;background:#0b1422;border:1px solid #1a3354;padding:10px;color:white;margin-bottom:10px}
.card{background:#0b1422;padding:10px;margin-bottom:5px;border-left:4px solid #2f80ed;cursor:pointer}
</style></head><body>
<div class="side">
  <input type="text" id="q" placeholder="Gare...">
  <div id="sug"></div>
  <hr><div id="list"></div>
</div>
<div class="main" id="det">Choisissez une gare</div>
<script>
const q=document.getElementById('q'), sug=document.getElementById('sug'), list=document.getElementById('list'), det=document.getElementById('det');
q.oninput = () => {
  if(q.value.length<2) return;
  fetch('/api/places?q='+q.value).then(r=>r.json()).then(d=>{
    sug.innerHTML = (d.places||[]).map(p=>'<div style="cursor:pointer;padding:5px" onclick="sel(\\''+p.id+'\\')">'+p.name+'</div>').join('');
  });
};
function sel(id){
  sug.innerHTML='';
  fetch('/api/departures?stop='+id).then(r=>r.json()).then(d=>{
    list.innerHTML = (d.departures||[]).map(t=>'<div class="card" onclick="track(\\''+t.links.find(l=>l.type==='vehicle_journey').id+'\\')">'+t.display_informations.headsign+' ('+t.stop_date_time.departure_date_time.slice(9,14)+')</div>').join('');
  });
}
function track(id){
  fetch('/api/vehicle?id='+id).then(r=>r.json()).then(d=>{
    const v=d.vehicle_journeys[0];
    det.innerHTML = '<h2>Train '+v.display_informations.headsign+'</h2>'+v.stop_times.map(s=>'<div>'+s.arrival_time.slice(0,5)+' - '+s.stop_point.name+'</div>').join('');
  });
}
</script></body></html>`;
