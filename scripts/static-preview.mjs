import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function serveFile(root, base, pathname) {
  const decoded = decodeURIComponent(pathname);
  if (!decoded.startsWith(base)) throw new Error("Outside deployment base");
  let file = resolve(root, decoded.slice(base.length));
  if (!file.startsWith(`${resolve(root)}${sep}`) && file !== resolve(root)) throw new Error("Outside site");
  if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
  const contentType = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  }[extname(file)] || "application/octet-stream";
  return { bytes: await readFile(file), contentType };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(async (req, res) => {
    try {
      const { bytes, contentType } = await serveFile("src/browser-host/dist",
        process.env.VITE_BASE || "/", new URL(req.url, "http://localhost").pathname);
      res.writeHead(200, { "content-type": contentType });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }).listen(4175, "127.0.0.1");
}
