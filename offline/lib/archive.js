'use strict';
/**
 * Archivador de páginas web a un único fichero HTML autocontenido.
 * Sin dependencias: usa fetch nativo de Node 18+.
 *
 * Inlinea: CSS (con @import y url() recursivos), imágenes, fuentes, iconos,
 * scripts y estilos en atributo. Los enlaces a páginas que también se archivan
 * se reescriben a rutas locales; el resto quedan absolutos.
 */
const { URL } = require('url');

const DEFAULTS = {
  depth: 0,              // 0 = solo esa página, 1 = + enlaces del mismo sitio, ...
  maxPages: 25,
  maxAssetBytes: 4 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
  timeoutMs: 20000,
  includeScripts: true,
  concurrency: 6,
  userAgent: 'Mozilla/5.0 (compatible; ArchivadorOffline/1.0; +local)',
};

const BINARY_OK = /^(image|font|audio|video)\//;
const TEXTUAL = /^(text\/|application\/(javascript|json|xml|xhtml))/;

/* ---------- utilidades ---------- */

function semaphore(n) {
  let active = 0; const queue = [];
  const next = () => { if (active >= n || !queue.length) return; active++; queue.shift()(); };
  return fn => new Promise((res, rej) => {
    queue.push(() => fn().then(res, rej).finally(() => { active--; next(); }));
    next();
  });
}

async function asyncReplace(str, re, fn) {
  const jobs = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(str)) !== null) {
    jobs.push({ args: [...m], start: m.index, end: m.index + m[0].length });
    if (!re.global) break;
    if (m[0] === '') re.lastIndex++;
  }
  if (!jobs.length) return str;
  const reps = await Promise.all(jobs.map(j => fn(...j.args)));
  let out = '', last = 0;
  jobs.forEach((j, i) => { out += str.slice(last, j.start) + reps[i]; last = j.end; });
  return out + str.slice(last);
}

function abs(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** URLs equivalentes: "/dir/" == "/dir/index.html" */
function aliases(u) {
  const out = new Set([u]);
  try {
    const url = new URL(u);
    const p = url.pathname;
    if (/\/(index\.html?|default\.html?)$/i.test(p)) { url.pathname = p.replace(/\/(index\.html?|default\.html?)$/i, '/'); out.add(url.href); }
    else if (p.endsWith('/')) { for (const n of ['index.html', 'index.htm']) { url.pathname = p + n; out.add(url.href); } }
    else { url.pathname = p + '/'; out.add(url.href); }
  } catch {}
  return [...out];
}

function slug(u) {
  const url = new URL(u);
  let s = (url.hostname + url.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  if (url.search) s += '-' + Buffer.from(url.search).toString('hex').slice(0, 8);
  return (s || 'pagina').slice(0, 80);
}

/* ---------- estado de una sesión de archivado ---------- */

function newState(opts, log) {
  return {
    opt: { ...DEFAULTS, ...opts },
    cache: new Map(),      // url -> {buf, type} | null
    bytes: 0,
    assets: 0,
    failed: [],
    log: log || (() => {}),
    limit: semaphore((opts && opts.concurrency) || DEFAULTS.concurrency),
  };
}

async function grab(url, state, asText) {
  if (state.cache.has(url)) return state.cache.get(url);
  const res = await state.limit(async () => {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': state.opt.userAgent, accept: '*/*' },
        signal: AbortSignal.timeout(state.opt.timeoutMs),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > state.opt.maxAssetBytes) throw new Error('recurso demasiado grande (' + (buf.length / 1048576).toFixed(1) + ' MB)');
      if (state.bytes + buf.length > state.opt.maxTotalBytes) throw new Error('límite total alcanzado');
      state.bytes += buf.length; state.assets++;
      return { buf, type, finalUrl: r.url || url };
    } catch (e) {
      state.failed.push({ url, error: e.message });
      state.log('warn', 'no se pudo bajar ' + url + ' — ' + e.message);
      return null;
    }
  });
  state.cache.set(url, res);
  if (!res) return null;
  return asText ? { ...res, text: res.buf.toString('utf8') } : res;
}

const dataUri = (buf, type) => 'data:' + (type || 'application/octet-stream') + ';base64,' + buf.toString('base64');

/* ---------- CSS ---------- */

async function inlineCss(css, baseUrl, state, depth = 0) {
  if (depth > 4) return css;
  // @import url("x") / @import "x"
  css = await asyncReplace(css, /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/gi,
    async (whole, href, media) => {
      const u = abs(href, baseUrl); if (!u) return '';
      const got = await grab(u, state, true);
      if (!got) return '';
      const nested = await inlineCss(got.text, u, state, depth + 1);
      return media && media.trim() ? '@media ' + media.trim() + '{' + nested + '}' : nested;
    });
  // url(...)
  css = await asyncReplace(css, /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, async (whole, q, href) => {
    if (/^(data:|about:|#)/i.test(href)) return whole;
    const u = abs(href, baseUrl); if (!u) return whole;
    const got = await grab(u, state);
    if (!got) return whole;
    return 'url("' + dataUri(got.buf, got.type) + '")';
  });
  return css;
}

/* ---------- HTML ---------- */

async function inlineHtml(html, pageUrl, state, pageMap) {
  // <base href> manda para resolver, y luego se elimina
  const baseM = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i);
  const base = baseM ? (abs(baseM[1], pageUrl) || pageUrl) : pageUrl;
  html = html.replace(/<base\b[^>]*>/gi, '');

  const attrUrl = async (tagText, attr, transform) => {
    const re = new RegExp('(\\b' + attr + '\\s*=\\s*)(["\'])(.*?)\\2', 'i');
    const m = tagText.match(re);
    if (!m) return tagText;
    const out = await transform(m[3]);
    if (out === null) return tagText;
    return tagText.replace(re, (w, p1, q) => p1 + '"' + out.replace(/"/g, '&quot;') + '"');
  };

  const inlineAsset = async href => {
    if (!href || /^(data:|about:|javascript:|#)/i.test(href)) return null;
    const u = abs(href, base); if (!u) return null;
    const got = await grab(u, state);
    if (!got) return u;                       // deja la URL absoluta si falla
    const type = got.type || '';
    if (BINARY_OK.test(type) || type === 'image/svg+xml' || !TEXTUAL.test(type)) return dataUri(got.buf, got.type);
    return dataUri(got.buf, got.type || 'text/plain');
  };

  // 1) hojas de estilo -> <style>
  html = await asyncReplace(html, /<link\b[^>]*>/gi, async tag => {
    const rel = (tag.match(/\brel\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || '';
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) return tag;
    if (/stylesheet/i.test(rel)) {
      const u = abs(href, base); if (!u) return tag;
      const got = await grab(u, state, true);
      if (!got) return '<!-- css no disponible: ' + esc(u) + ' -->';
      const media = (tag.match(/\bmedia\s*=\s*["']([^"']+)["']/i) || [])[1];
      const css = await inlineCss(got.text, got.finalUrl || u, state);
      state.log('info', 'css inlineado: ' + u);
      return '<style' + (media ? ' media="' + esc(media) + '"' : '') + '>\n' + css + '\n</style>';
    }
    if (/icon|apple-touch|preload|manifest/i.test(rel)) {
      if (/preload|manifest/i.test(rel)) return '';   // inútiles offline
      return await attrUrl(tag, 'href', inlineAsset);
    }
    return tag;
  });

  // 2) scripts
  html = await asyncReplace(html, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, async (whole, attrs, body) => {
    const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!state.opt.includeScripts) return src ? '' : (/\btype\s*=\s*["'](application\/ld\+json|text\/template)/i.test(attrs) ? whole : '');
    if (!src) return whole;
    const u = abs(src, base); if (!u) return whole;
    const got = await grab(u, state, true);
    if (!got) return '<!-- js no disponible: ' + esc(u) + ' -->';
    const keep = attrs.replace(/\bsrc\s*=\s*["'][^"']*["']/i, '').replace(/\b(async|defer|integrity\s*=\s*["'][^"']*["']|crossorigin(\s*=\s*["'][^"']*["'])?)/gi, '');
    return '<script' + keep + '>\n' + got.text.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  });

  // 3) imágenes, media y sus srcset
  html = await asyncReplace(html, /<(img|source|video|audio|embed|iframe|input)\b[^>]*>/gi, async tag => {
    let out = tag;
    out = await attrUrl(out, 'src', async href => {
      if (/^<iframe/i.test(tag)) { const u = abs(href, base); return u; } // no incrustamos iframes
      return await inlineAsset(href);
    });
    out = await attrUrl(out, 'poster', inlineAsset);
    out = await attrUrl(out, 'srcset', async val => {
      const parts = await Promise.all(val.split(',').map(async p => {
        const seg = p.trim().split(/\s+/);
        const got = await inlineAsset(seg[0]);
        return [got ?? seg[0], ...seg.slice(1)].join(' ');
      }));
      return parts.join(', ');
    });
    out = out.replace(/\b(loading|decoding)\s*=\s*["'][^"']*["']/gi, '');
    return out;
  });

  // 4) estilos en atributo
  html = await asyncReplace(html, /\bstyle\s*=\s*"([^"]*url\([^"]*)"/gi, async (whole, css) => {
    const done = await inlineCss(css, base, state);
    return 'style="' + done.replace(/"/g, "'") + '"';
  });

  // 5) <style> embebidos
  html = await asyncReplace(html, /<style\b([^>]*)>([\s\S]*?)<\/style>/gi, async (whole, attrs, css) =>
    '<style' + attrs + '>' + await inlineCss(css, base, state) + '</style>');

  // 6) enlaces: a páginas archivadas -> fichero local; el resto -> absoluto
  html = await asyncReplace(html, /<a\b[^>]*>/gi, async tag =>
    await attrUrl(tag, 'href', href => {
      if (/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return null;
      const u = abs(href, base); if (!u) return null;
      const clean = u.split('#')[0];
      if (pageMap && pageMap.has(clean)) {
        const frag = u.includes('#') ? '#' + u.split('#').slice(1).join('#') : '';
        return './' + pageMap.get(clean) + frag;
      }
      return u;
    }));

  // 7) forms y otros atributos que apuntan fuera
  html = html.replace(/<form\b([^>]*)>/gi, (w, a) => '<form' + a.replace(/\baction\s*=\s*["'][^"']*["']/i, '') + ' onsubmit="return false"' + '>');

  return html;
}

function banner(url, when, stats) {
  return `<div id="__archivo_offline__" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;
background:#111827;color:#e5e7eb;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:7px 12px;
display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #374151">
<span>📦 Copia offline de <a href="${esc(url)}" style="color:#93c5fd">${esc(url)}</a> · ${esc(when)} · ${stats.assets} recursos · ${(stats.bytes / 1048576).toFixed(2)} MB</span>
<button onclick="document.getElementById('__archivo_offline__').remove()"
 style="background:#374151;color:#e5e7eb;border:0;border-radius:6px;padding:4px 10px;cursor:pointer">ocultar</button></div>`;
}

/* ---------- API pública ---------- */

/**
 * Archiva una url. Devuelve { pages: [{url, filename, html, title}], stats }
 */
async function archive(startUrl, opts = {}, log = () => {}) {
  const state = newState(opts, log);
  const start = new URL(startUrl).href;
  const origin = new URL(start).origin;

  // 1) descubrir páginas (BFS hasta la profundidad pedida)
  const found = new Map();           // url -> {html, finalUrl}
  const queue = [{ url: start, d: 0 }];
  const seen = new Set(aliases(start.split('#')[0]));

  while (queue.length && found.size < state.opt.maxPages) {
    const { url, d } = queue.shift();
    log('info', 'descargando página ' + url);
    const got = await grab(url, state, true);
    if (!got) continue;
    if (!/text\/html|application\/xhtml/.test(got.type || '')) {
      if (url === start) throw new Error('esa URL no devuelve HTML (' + (got.type || 'tipo desconocido') + ')');
      continue;
    }
    found.set(url.split('#')[0], { html: got.text, finalUrl: got.finalUrl || url });
    if (d < state.opt.depth) {
      const links = [...got.text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
      for (const href of links) {
        const u = abs(href, got.finalUrl || url); if (!u) continue;
        const clean = u.split('#')[0];
        if (new URL(clean).origin !== origin) continue;
        if (aliases(clean).some(a => seen.has(a))) continue;
        if (/\.(pdf|zip|jpg|jpeg|png|gif|svg|mp4|mp3|webm|docx?|xlsx?)$/i.test(clean)) continue;
        for (const a of aliases(clean)) seen.add(a);
        queue.push({ url: clean, d: d + 1 });
        if (seen.size >= state.opt.maxPages) break;
      }
    }
  }
  if (!found.size) throw new Error('no se pudo descargar ninguna página de ' + startUrl);

  // 2) nombres de fichero locales
  const pageMap = new Map();
  const used = new Set();
  let i = 0;
  for (const url of found.keys()) {
    let name = (url.split('#')[0] === start.split('#')[0]) ? 'index' : slug(url);
    while (used.has(name)) name = name + '-' + (++i);
    used.add(name);
    for (const a of aliases(url)) if (!pageMap.has(a)) pageMap.set(a, name + '.html');
  }

  // 3) inlinear cada página
  const when = new Date().toLocaleString('es-ES');
  const pages = [];
  for (const [url, { html, finalUrl }] of found) {
    log('info', 'incrustando recursos de ' + url);
    let out = await inlineHtml(html, finalUrl, state, pageMap);
    const title = (out.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim().slice(0, 200) || url;
    out = out.replace(/<\/body>/i, banner(url, when, state) + '</body>');
    if (!/<\/body>/i.test(html)) out += banner(url, when, state);
    out = out.replace(/<head([^>]*)>/i, '<head$1><meta name="archivado-desde" content="' + esc(url) + '"><meta name="archivado-el" content="' + esc(when) + '">');
    pages.push({ url, filename: pageMap.get(url), html: out, title });
  }

  return {
    pages,
    stats: { assets: state.assets, bytes: state.bytes, failed: state.failed, pageCount: pages.length, when },
  };
}

module.exports = { archive, slug, aliases, DEFAULTS };
