import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./dist/', import.meta.url)).replace(/\/$/, '');
const portValue = process.env.VIBEFORGE_SESSION_PORT ?? process.env.PORT;
if (!portValue || !/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
  console.error('Для запуска нужен назначенный порт VIBEFORGE_SESSION_PORT или PORT (1–65535).');
  process.exit(1);
}
const port = Number(portValue);
const host = process.env.HOST ?? '0.0.0.0';
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) {res.writeHead(403);res.end();return;}
    const bytes = await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.on('error', error => {
  console.error(`Не удалось запустить сайт: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port,host,()=>console.log(`Сайт запущен на http://${host}:${port}`));
