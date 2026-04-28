const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.SNCF_API_KEY || "TA_CLE_ICI";

// =========================
// 🔧 SNCF API WRAPPER
// =========================
function sncfGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.sncf.com",
      path: "/v1/coverage/sncf/" + path,
      headers: {
        Authorization: "Basic " + Buffer.from(API_KEY + ":").toString("base64")
      }
    };

    https.get(options, (res) => {
      let data = "";

      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

// =========================
// 🌐 SERVER
// =========================
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, "http://localhost");
  const path = urlObj.pathname;
  const q = Object.fromEntries(urlObj.searchParams.entries());

  res.setHeader("Access-Control-Allow-Origin", "*");

  // =========================
  // 🔍 SEARCH PLACES (GARES)
  // =========================
  if (path === "/api/places") {
    const query = (q.q || "").trim();

    if (!query) {
      res.end(JSON.stringify({ places: [] }));
      return;
    }

    try {
      const data = await sncfGet(
        "places?q=" + encodeURIComponent(query) + "&type[]=stop_area&count=10"
      );

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    } catch (e) {
      res.end(JSON.stringify({ error: e.toString() }));
    }
    return;
  }

  // =========================
  // 🏠 FRONT
  // =========================
  res.setHeader("Content-Type", "text/html");
  res.end(HTML);
});

// =========================
// 🚀 START
// =========================
server.listen(PORT, () => {
  console.log("🚄 SNCF OPS CENTER");
  console.log("🌐 http://localhost:" + PORT);
});


// =========================
// 🎨 FRONTEND (PROPRE UI)
// =========================
const HTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>SNCF OPS CENTER</title>

<style>
body {
  font-family: Arial;
  background: #0f172a;
  color: white;
  padding: 40px;
}

h2 {
  margin-bottom: 20px;
}

input {
  padding: 12px;
  width: 350px;
  border-radius: 8px;
  border: none;
  outline: none;
  font-size: 16px;
}

.sugg {
  margin-top: 8px;
  width: 350px;
  background: #1e293b;
  border-radius: 8px;
  overflow: hidden;
  display: none;
}

.sugg.on {
  display: block;
}

.sug {
  padding: 12px;
  cursor: pointer;
  border-bottom: 1px solid #334155;
}

.sug:hover {
  background: #334155;
}
</style>
</head>

<body>

<h2>🚄 Recherche de gares SNCF</h2>

<input id="search" placeholder="Tape une ville (ex: Reims)">
<div id="sugg" class="sugg"></div>

<script>
const input = document.getElementById("search");
const sugg = document.getElementById("sugg");

let timer;

input.addEventListener("input", () => {

  clearTimeout(timer);

  timer = setTimeout(() => {

    const value = input.value.trim();

    if (!value) {
      sugg.classList.remove("on");
      sugg.innerHTML = "";
      return;
    }

    fetch("/api/places?q=" + encodeURIComponent(value))
      .then(r => r.json())
      .then(d => {

        sugg.innerHTML = "";

        const stops = (d.places || [])
          .filter(p => p.embedded_type === "stop_area");

        if (!stops.length) {
          sugg.classList.remove("on");
          return;
        }

        stops.forEach(p => {
          const name = p.stop_area.label;

          const div = document.createElement("div");
          div.className = "sug";
          div.textContent = name;

          div.onclick = () => {
            input.value = name;
            sugg.classList.remove("on");
          };

          sugg.appendChild(div);
        });

        sugg.classList.add("on");
      })
      .catch(err => console.error(err));

  }, 200); // debounce
});
</script>

</body>
</html>
`;
