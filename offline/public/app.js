'use strict';
const $ = s => document.querySelector(s);
const log = $('#log'), list = $('#list');
let items = [], filter = '';

const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const fmtDate = d => new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function say(msg, cls) {
  log.classList.add('on');
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = msg;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

async function load() {
  try { items = await (await fetch('/api/list')).json(); } catch { items = []; }
  render();
}

function render() {
  const q = filter.toLowerCase();
  const shown = items.filter(i => !q || (i.title + ' ' + i.url).toLowerCase().includes(q));
  if (!shown.length) {
    list.innerHTML = '<div class="empty">' +
      (items.length ? 'Nada coincide con ese filtro.' : 'Todavía no has guardado ninguna página. Pega una URL arriba.') +
      '</div>';
    return;
  }
  list.innerHTML = shown.map(i => `
    <article class="item">
      <div>
        <div class="t">${esc(i.title || i.url)}</div>
        <div class="u">${esc(i.url)}</div>
        <div class="meta">
          <span>${esc(fmtDate(i.date))}</span>
          <span>${fmtBytes(i.bytes)}</span>
          <span>${i.assets} recursos</span>
          ${i.pages.length > 1 ? `<span class="tagp">${i.pages.length} páginas</span>` : ''}
          ${i.failed ? `<span title="recursos que no se pudieron bajar">⚠ ${i.failed} fallidos</span>` : ''}
        </div>
      </div>
      <div class="acts">
        <button class="mini" data-open="${i.id}">Abrir</button>
        <button class="mini" data-dl="${i.id}">Descargar</button>
        <button class="mini danger" data-del="${i.id}">Borrar</button>
      </div>
    </article>`).join('');
}

list.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.open || b.dataset.dl || b.dataset.del;
  const it = items.find(x => x.id === id); if (!it) return;
  const main = it.pages[0].filename;
  if (b.dataset.open) window.open('/saved/' + id + '/' + main, '_blank');
  if (b.dataset.dl) {
    const a = document.createElement('a');
    a.href = '/saved/' + id + '/' + main;
    a.download = (it.title || 'pagina').replace(/[^\w\d ]+/g, '').slice(0, 60).trim() + '.html';
    document.body.appendChild(a); a.click(); a.remove();
  }
  if (b.dataset.del) {
    if (!confirm('¿Borrar la copia de ' + it.url + '?')) return;
    await fetch('/api/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }
});

$('#q').addEventListener('input', e => { filter = e.target.value; render(); });

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#go');
  btn.disabled = true; btn.textContent = 'Descargando…';
  log.innerHTML = ''; log.classList.add('on');
  const payload = {
    url: $('#url').value,
    depth: +$('#depth').value,
    maxPages: +$('#maxPages').value,
    includeScripts: $('#js').checked,
  };
  try {
    const res = await fetch('/api/save', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'error del servidor');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        const ev = JSON.parse(l);
        if (ev.type === 'log') say((ev.level === 'warn' ? '⚠ ' : '· ') + ev.msg, ev.level === 'warn' ? 'warn' : '');
        if (ev.type === 'error') say('✖ ' + ev.error, 'warn');
        if (ev.type === 'done') {
          say('✔ Guardado: ' + ev.entry.pages.length + ' página(s), ' + ev.entry.assets + ' recursos, ' + fmtBytes(ev.entry.bytes), 'ok');
          $('#url').value = '';
          load();
        }
      }
    }
  } catch (err) {
    say('✖ ' + err.message, 'warn');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar copia offline';
  }
});

load();
