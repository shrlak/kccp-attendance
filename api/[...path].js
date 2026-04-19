const http = require("http");

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Device-Id");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // Read body
  let body = "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    await new Promise((resolve) => {
      req.on("data", chunk => body += chunk);
      req.on("end", resolve);
    });
  }

  // Proxy to Oracle Cloud
  const url = new URL(req.url, "http://localhost");
  const targetPath = url.pathname + url.search;

  return new Promise((resolve) => {
    const options = {
      hostname: "158.101.118.21",
      port: 3000,
      path: targetPath,
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {})
      },
      timeout: 10000
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let data = "";
      proxyRes.on("data", chunk => data += chunk);
      proxyRes.on("end", () => {
        res.status(proxyRes.statusCode || 200);
        res.setHeader("Content-Type", "application/json");
        res.end(data);
        resolve();
      });
    });

    proxyReq.on("error", () => {
      res.status(200).json({ offline: true, error: "Server unreachable" });
      resolve();
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      res.status(200).json({ offline: true, error: "Server timeout" });
      resolve();
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
};
