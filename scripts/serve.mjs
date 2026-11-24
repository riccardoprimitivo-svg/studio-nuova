// Server locale minimale: web/ alla radice, dist/ sotto /dist/. Solo per provare l'app.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const port = Number(process.env.PORT ?? 5173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (rel === "/portale") rel = "/portale.html";
  const base = rel.startsWith("/dist/") ? root : join(root, "web");
  const file = normalize(join(base, rel));
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch {
    res.writeHead(404).end("non trovato");
  }
}).listen(port, "127.0.0.1", () => console.log(`Studio. in locale su http://localhost:${port}`));
