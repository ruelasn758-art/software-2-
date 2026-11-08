// Servidor de archivos para desarrollo local; no recibe ni guarda reportes.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Origen separado de la vista previa anterior: también aísla localStorage.
const port = 4174;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  let resource;
  try { resource = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (resource === "/") resource = "/index.html";
  const allowed = /^\/(?:index\.html|nueva-incidencia\.html|iniciar-sesion\.html|crear-cuenta\.html|dashboard-admin\.html|(?:css|js|assets)\/[a-zA-Z0-9_./-]+)$/.test(resource);
  const file = path.resolve(root, `.${resource}`);
  const type = types[path.extname(file)];
  if (!allowed || !type || !file.startsWith(root + path.sep) || resource.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404); response.end(); return;
  }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": type + (type.startsWith("text/") ? "; charset=utf-8" : ""), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : content);
  });
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `El puerto ${port} está ocupado. Cierra la otra vista previa y vuelve a intentarlo.` : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`PUNO REPORTA PRUEBAS: http://127.0.0.1:${port} · Detener con Ctrl+C`));
