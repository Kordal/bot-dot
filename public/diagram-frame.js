// The frame the web page's diagrams are drawn in (diagram-frame.html, ADR 041): botdot's own Mermaid draws each source
// the page sends and hands the SVG back as text, which the page cleans before it shows it (diagrams.js). It answers
// only the page that holds it, from the same address, and first says whether Mermaid is there.
// A plain <script> after vendor/mermaid/mermaid.min.js; the tests load it the same way.

(function (root) {

// Drawn only when asked, at the strict level (no script, no click handler, labels cleaned), in the dark theme on the
// page's black and in its font. Mermaid puts no error drawing of its own on the frame: a failed block is the page's.
const SETTINGS = {
  startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'dark',
  themeVariables: { background: '#000000', fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
};

const page = root.parent;
const say = (message) => page.postMessage(message, root.location.origin);

try { root.mermaid.initialize(SETTINGS); }
catch (e) { say({ ready: false, error: `Mermaid did not load: ${e.message}` }); return; }

root.addEventListener('message', async (e) => {
  if (e.source !== page || e.origin !== root.location.origin) return;
  const { id, source } = e.data || {};
  if (!Number.isInteger(id) || typeof source !== 'string') return;
  try { say({ id, svg: (await root.mermaid.render(`diagram-${id}`, source)).svg }); }
  catch (err) { say({ id, error: String(err?.message || err) }); }
});
say({ ready: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
