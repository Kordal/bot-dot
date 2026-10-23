// botdot kit (#400): the few things an interactive page does with botdot, for plain HTML and for Svelte alike.
// Load it before your own script: <script src="kit/botdot-kit.js"></script>. It sets window.botdot:
//   botdot.data()            the page's data.json, parsed (a Promise); {} when it has none
//   botdot.onValues(fn)      fn(values) with the live values of the Board tiles named at publish, now if they came
//                            already and again on each change; values maps each name to { title, data, at }
//   botdot.open(url)         asks the app to open a link out: the owner sees where it leads first
//   botdot.ring(el, pct, label)   draws the hero's ring into el
//   botdot.spark(points)     an SVG sparkline (a string) for a kpi
//   botdot.esc(text)         text made safe to put into innerHTML
// A click on a link to http(s) goes through botdot.open by itself: the sandbox opens nothing on its own.
(function () {
  'use strict';
  var last = null;
  var listeners = [];

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.botdot !== 'values' || !d.values || typeof d.values !== 'object') return;
    last = d.values;
    listeners.forEach(function (fn) { try { fn(last); } catch (err) { console.error(err); } });
  });

  function data() {
    return fetch('data.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }

  function onValues(fn) {
    listeners.push(fn);
    if (last) fn(last);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  function open(url) {
    if (!/^https?:\/\//i.test(String(url))) return;
    parent.postMessage({ botdot: 'open', url: String(url) }, '*');
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !/^https?:\/\//i.test(a.getAttribute('href'))) return;
    e.preventDefault();
    open(a.href);
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var rings = 0;
  function ring(el, pct, label) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    var r = 62, len = 2 * Math.PI * r, id = 'botdot-ring-' + (++rings);
    el.classList.add('ring');
    el.innerHTML =
      '<svg viewBox="0 0 150 150" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '"><stop offset="0" stop-color="#45c78e"/><stop offset="1" stop-color="#378add"/></linearGradient></defs>' +
      '<circle cx="75" cy="75" r="' + r + '" stroke="#1d1d1d" stroke-width="12" fill="none"/>' +
      '<circle cx="75" cy="75" r="' + r + '" stroke="url(#' + id + ')" stroke-width="12" fill="none" stroke-linecap="round" ' +
      'stroke-dasharray="' + (len * p / 100).toFixed(1) + ' ' + len.toFixed(1) + '" transform="rotate(-90 75 75)"/></svg>' +
      '<div class="c"><div><b>' + Math.round(p) + '%</b><span>' + esc(label || '') + '</span></div></div>';
  }

  function spark(points) {
    var v = (points || []).map(Number).filter(function (n) { return isFinite(n); });
    if (v.length < 2) return '';
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v), span = max - min || 1;
    var d = v.map(function (n, i) {
      return (i ? 'L' : 'M') + (i * 100 / (v.length - 1)).toFixed(1) + ' ' + (28 - (n - min) * 26 / span).toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="#378add" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
  }

  window.botdot = { data: data, onValues: onValues, open: open, ring: ring, spark: spark, esc: esc };
})();
