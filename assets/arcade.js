// Tiny shared helpers used by every game (optional, games work without it).
window.Arcade = (function () {
  const beeps = {};
  let ctx = null;
  function audio() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    return ctx;
  }
  function beep(freq = 440, dur = 0.08, type = 'square', gain = 0.05) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g); g.connect(a.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.stop(a.currentTime + dur + 0.02);
  }
  function keys() {
    const s = {};
    addEventListener('keydown', e => { s[e.key] = true; s[e.code] = true; });
    addEventListener('keyup', e => { s[e.key] = false; s[e.code] = false; });
    return s;
  }
  function best(id, score) {
    const k = 'arcade-best-' + id;
    const prev = +(localStorage.getItem(k) || 0);
    if (score > prev) { localStorage.setItem(k, score); return score; }
    return prev;
  }
  function loop(fn) {
    let last = performance.now();
    function step(t) { const dt = Math.min(50, t - last); last = t; fn(dt / 1000, t); requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  return { beep, keys, best, loop };
})();
