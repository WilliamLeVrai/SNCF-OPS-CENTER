const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 10000;

// =====================
// 🔧 CONFIG SNCF
// =====================
const API_KEY = process.env.SNCF_API_KEY || "TA_CLE_ICI";

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

// =====================
// 🌐 SERVER
// =====================
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, "http://localhost");
  const path = urlObj.pathname;
  const q = Object.fromEntries(urlObj.searchParams.entries());

  res.setHeader("Access-Control-Allow-Origin", "*");

  // =====================
  // 🔍 API PLACES (FIXED)
  // =====================
  if (path === "/api/places") {
    const query = (q.q || "").trim();

    if (!query) {
      res.end(JSON.stringify({ places: [] }));
      return;
    }

    try {
      const data = await sncfGet(
        "places?q=" + encodeURIComponent(query) + "&type[]=stop_area&count=8"
      );

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    } catch (e) {
      res.end(JSON.stringify({ error: e.toString() }));
    }

    return;
  }

  // =====================
  // 🧾 HTML FRONT
  // =====================
  res.setHeader("Content-Type", "text/html");
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log("🚄 SNCF OPS CENTER");
  console.log("🌐 http://localhost:" + PORT);
});


// =====================
// 🎨 FRONT HTML (FIXED)
// =====================
const HTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>SNCF OPS CENTER</title>

<style>
body {
  font-family: Arial;
  padding: 20px;
}

input {
  padding: 10px;
  width: 300px;
}

.sugg {
  border: 1px solid #ccc;
  width: 300px;
  display: none;
}

.sugg.on {
  display: block;
}

.sug {
  padding: 8px;
  cursor: pointer;
}

.sug:hover {
  background: #eee;
}
</style>
</head>

<body>

<h2>Recherche gare</h2>

<input id="search" placeholder="Tape une gare...">
<div id="sugg" class="sugg"></div>

<script>
const input = document.getElementById("search");
const sugg = document.getElementById("sugg");

input.addEventListener("input", () => {

  const value = input.value.trim();

  if (!value) {
    sugg.classList.remove("on");
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
    .catch(err => {
      console.error(err);
    });
});
</script>

</body>
</html>
`;
