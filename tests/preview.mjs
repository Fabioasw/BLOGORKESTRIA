// Local static preview only; never included in Cloudflare static assets.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.xml':'application/xml', '.txt':'text/plain' };
http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1:8787');
    let path = decodeURIComponent(url.pathname);
    if (path === '/totvs-rm/' || path === '/privacidade/') { res.writeHead(308,{Location:path.slice(0,-1)+url.search});res.end();return; }
    if (path === '/') path = '/index.html';
    if (path.endsWith('/')) path += 'index.html';
    if (!extname(path)) path += '.html';
    const file = resolve(root,'.'+path);
    if (!file.startsWith(root.endsWith(sep)?root:root+sep) || !/^\/(?:assets\/[^/]+\.(?:css|js|svg)|blog\/[^/]+\.(?:html|css)|(?:index|processos|totvs-rm|privacidade)\.html|sitemap\.xml|robots\.txt)$/.test(path) || !existsSync(file)) { res.writeHead(404);res.end('Não encontrado');return; }
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.end(await readFile(file));
  } catch {res.writeHead(500);res.end('Erro na prévia');}
}).listen(8787,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8787/totvs-rm'));
