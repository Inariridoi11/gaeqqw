#!/usr/bin/env node
'use strict';
/**
 * Archivador offline — servidor local mínimo (sin dependencias).
 *   node offline/server.js [--port 7777]
 * Luego abre http://localhost:7777
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { archive } = require('./lib/archive');

const ROOT = __dirname;
const STORE = path.join(ROOT, 'archive');
const INDEX = path.join(STORE, 'index.json');
const argAt = process.argv.indexOf('--port');
const portArg = argAt !== -1 ? process.argv[argAt + 1] : null;
const PORT = (n => Number.isInteger(n) && n > 0 && n < 65536 ? n : 7777)(parseInt(portArg || process.env.PORT, 10));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

async function readIndex() {
  try { return JSON.parse(await fsp.readFile(INDEX, 'utf8')); } catch { return []; }
}
async function writeIndex(list) {
  await fsp.mkdir(STORE, { recursive: true });
  await fsp.writeFile(INDEX, JSON.stringify(list, null, 2));
}
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const body = req => new Promise((ok, no) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } });
});

async function handleSave(req, res) {
  const opts = await body(req);
  const raw = (opts.url || '').trim();
  if (!raw) return send(res, 400, { error: 'Escribe una dirección' });
  // sin esquema: probamos https y, si falla, http (al revés en redes locales)
  const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[?::1)/i.test(raw) || /\.local(:|\/|$)/i.test(raw);
  const candidates = /^https?:\/\//i.test(raw) ? [raw] : (local ? ['http://' + raw, 'https://' + raw] : ['https://' + raw, 'http://' + raw]);
  for (const c of candidates) { try { new URL(c); } catch { return send(res, 400, { error: 'URL no válida' }); } }

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  const line = o => res.write(JSON.stringify(o) + '\n');
  const log = (level, msg) => line({ type: 'log', level, msg });

  try {
    const cfg = {
      depth: Math.max(0, Math.min(3, +opts.depth || 0)),
      maxPages: Math.max(1, Math.min(200, +opts.maxPages || 25)),
      includeScripts: opts.includeScripts !== false,
    };
    let result, url, lastErr;
    for (const c of candidates) {
      try { result = await archive(c, cfg, log); url = c; break; }
      catch (e) {
        lastErr = e;
        if (c !== candidates[candidates.length - 1]) log('warn', 'no funcionó con ' + c.split('://')[0] + ', probando ' + candidates[candidates.indexOf(c) + 1].split('://')[0]);
      }
    }
    if (!result) throw lastErr;

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const dir = path.join(STORE, id);
    await fsp.mkdir(dir, { recursive: true });
    let bytes = 0;
    for (const p of result.pages) {
      await fsp.writeFile(path.join(dir, p.filename), p.html);
      bytes += Buffer.byteLength(p.html);
    }
    const entry = {
      id, url, title: result.pages[0].title, date: new Date().toISOString(),
      pages: result.pages.map(p => ({ url: p.url, filename: p.filename, title: p.title })),
      bytes, assets: result.stats.assets, failed: result.stats.failed.length, depth: +opts.depth || 0,
    };
    const list = await readIndex();
    list.unshift(entry);
    await writeIndex(list);
    line({ type: 'done', entry });
  } catch (e) {
    line({ type: 'error', error: e.message });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(u.pathname);
  try {
    if (p === '/api/list') return send(res, 200, await readIndex());
    if (p === '/api/save' && req.method === 'POST') return handleSave(req, res);
    if (p === '/api/delete' && req.method === 'POST') {
      const { id } = await body(req);
      const list = await readIndex();
      const next = list.filter(x => x.id !== id);
      await fsp.rm(path.join(STORE, path.basename(id || '_')), { recursive: true, force: true });
      await writeIndex(next);
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/saved/')) {
      const rel = p.slice('/saved/'.length).split('/').map(s => path.basename(s));
      const file = path.join(STORE, ...rel);
      if (!file.startsWith(STORE)) return send(res, 403, { error: 'ruta no permitida' });
      const buf = await fsp.readFile(file);
      return send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
    }
    // estáticos de la interfaz
    const name = p === '/' ? '/index.html' : p;
    const file = path.join(ROOT, 'public', path.normalize(name).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'ruta no permitida' });
    const buf = await fsp.readFile(file);
    return send(res, 200, buf, MIME[path.extname(file)] || 'text/plain; charset=utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, { error: 'no encontrado' });
    return send(res, 500, { error: e.message });
  }
});

function start(port, tries = 0) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && tries < 10) {
      console.log('  El puerto ' + port + ' está ocupado, probando el ' + (port + 1) + '…');
      return start(port + 1, tries + 1);
    }
    if (err.code === 'EADDRINUSE') console.error('\n  ✖ No hay puertos libres entre ' + PORT + ' y ' + port + '.\n    Cierra el programa que los ocupa o usa:  node offline/server.js --port 9000\n');
    else if (err.code === 'EACCES') console.error('\n  ✖ Sin permiso para usar el puerto ' + port + '. Prueba uno por encima de 1024:  node offline/server.js --port 8080\n');
    else console.error('\n  ✖ ' + err.message + '\n');
    process.exit(1);
  });
  server.listen(port);
}
server.on('listening', () => {
  const p = server.address().port;
  console.log('\n  📦 Archivador offline listo en  \x1b[36mhttp://localhost:' + p + '\x1b[0m');
  console.log('  Guardando en: ' + STORE);
  console.log('  Para parar: Ctrl+C\n');
});
start(PORT);
