// The web page on an iPhone or iPad (#963): in Safari, from the Home Screen and in the iOS app's window (WKWebView).
// - The keyboard: iOS doesn't shrink the page when the keyboard opens, it moves it up, so the chat's header went off
//   screen. While the keyboard is open (the visual viewport is shorter than the page and not zoomed in), the page is
//   pinned to what is visible: <html class="kb"> with --kb-top and --kb-h (style.css).
// - Links and downloads where the page has its own cookies (the Home Screen web app and an app's WKWebView, not
//   Safari): a new window of this botdot would open in Safari, signed out, and a download would replace the page with
//   no way back. There, a link of this botdot that opens a new window opens in a sheet over the page instead, and a
//   download goes to the share sheet (Save to Files, AirDrop, another app).
// Nothing changes anywhere else: a desktop browser, Android, the desktop app.
// A plain <script>, as window.Ios; the tests load it the same way.

(function (root) {

const isIos = (nav) => /iPad|iPhone|iPod/.test(String(nav?.userAgent || '')) || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
// The page's own cookies: from the Home Screen, or in an app's WKWebView (no "Safari/" in its user agent).
const inApp = (win) => isIos(win.navigator) && (win.navigator.standalone === true || !!win.matchMedia?.('(display-mode: standalone)')?.matches || !/Safari\//.test(String(win.navigator.userAgent || '')));

// What the keyboard leaves: { top, height } of the visible part while it is open, or null.
const KEYBOARD = 120; // px less than the page: a keyboard, not Safari's bars coming and going
function visible(win) {
  const vv = win.visualViewport;
  if (!vv || Math.abs((vv.scale || 1) - 1) > 0.01) return null; // zoomed in: the owner's own view, left as it is
  const page = Math.max(win.innerHeight || 0, win.document?.documentElement?.clientHeight || 0);
  if (page - vv.height < KEYBOARD) return null;
  return { top: Math.max(0, Math.round(vv.offsetTop)), height: Math.round(vv.height) };
}
function keyboard(win) {
  const vv = win.visualViewport;
  if (!vv || !isIos(win.navigator)) return;
  const html = win.document.documentElement;
  let frame = 0; // one fit a frame
  const fit = () => {
    frame = 0;
    const v = visible(win);
    html.classList.toggle('kb', !!v);
    if (!v) { html.style.removeProperty('--kb-top'); html.style.removeProperty('--kb-h'); return; }
    html.style.setProperty('--kb-top', `${v.top}px`);
    html.style.setProperty('--kb-h', `${v.height}px`);
    if (win.scrollY) win.scrollTo(0, 0); // the page scrolled up to show the field: it is shown where it is
  };
  const later = () => { if (frame) return; frame = 1; win.requestAnimationFrame(fit); };
  vv.addEventListener('resize', later);
  vv.addEventListener('scroll', later);
  win.addEventListener('scroll', later);
  fit();
}

const nameOf = (url) => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'file'; } catch { return 'file'; } };
// The page's words (i18n.js) and its toast (app.js), by name: a top-level const is no property of the window.
const words = () => (typeof tr === 'function' ? { close: tr('Close'), share: tr('Download'), failed: tr("Couldn't open it") } : { close: 'Close', share: 'Download', failed: "Couldn't open it" });
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

// A page of this botdot in a sheet over this one, same cookies; Close brings back the page where it was. With
// `file` (a File), its bar has the share button too.
function sheet(win, { href, name, file }) {
  const doc = win.document;
  const d = doc.createElement('dialog');
  d.className = 'page-sheet';
  const bar = doc.createElement('div');
  bar.className = 'page-sheet-bar';
  const title = doc.createElement('b');
  title.textContent = name || '';
  bar.append(title);
  if (file) {
    const share = doc.createElement('button');
    Object.assign(share, { type: 'button', className: 'icon-btn', innerHTML: SHARE });
    share.setAttribute('aria-label', words().share);
    share.onclick = () => win.navigator.share({ files: [file] }).catch(() => {});
    bar.append(share);
  }
  const close = doc.createElement('button');
  Object.assign(close, { type: 'button', className: 'icon-btn', innerHTML: CLOSE });
  close.setAttribute('aria-label', words().close);
  close.onclick = () => d.close();
  bar.append(close);
  const frame = doc.createElement('iframe');
  frame.src = href;
  frame.title = name || '';
  d.append(bar, frame);
  d.onclose = () => d.remove();
  doc.body.append(d);
  d.showModal();
  return d;
}

// A file to the share sheet. iOS shares only during the tap: when fetching it took too long, it opens in a sheet whose
// share button is a new tap. A browser that can't share files gets the sheet without it.
async function save(win, { href, name }) {
  let file;
  try {
    const res = await win.fetch(href, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const said = String(res.headers?.get?.('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/);
    name ||= (said && decodeURIComponent(said[1] || said[2])) || nameOf(href);
    file = new win.File([blob], name, { type: blob.type || 'application/octet-stream' });
  } catch {
    if (typeof toast === 'function') toast(words().failed, true);
    return 'failed';
  }
  if (!win.navigator.canShare?.({ files: [file] })) { sheet(win, { href, name }); return 'sheet'; }
  try {
    await win.navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    sheet(win, { href, name, file });
    return 'sheet';
  }
}

// Where the page has its own cookies: a link of this botdot opening a new window opens in a sheet, a download is
// saved. On the window, so the page's own handlers (the viewer, pictures) come first and keep what they took.
function links(win) {
  if (!inApp(win)) return;
  win.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    const href = open(win, a.href, { download: a.hasAttribute('download') ? a.getAttribute('download') || '' : null, blank: a.target === '_blank', name: a.title || a.textContent.trim() });
    if (href) e.preventDefault();
  });
}
// A link of this botdot, as the page would open it: true when it was taken. download: the name to save it under
// ('' for its own), or null; blank: it opens a new window.
function open(win, url, { download = null, blank = true, name = '' } = {}) {
  if (!inApp(win)) return false;
  let u;
  try { u = new URL(url, win.location.href); } catch { return false; }
  const own = u.origin === win.location.origin || (u.protocol === 'blob:' && url.startsWith(`blob:${win.location.origin}/`));
  if (!own) return false;
  if (download !== null) { save(win, { href: u.href, name: download }); return true; }
  if (!blank) return false;
  sheet(win, { href: u.href, name: name || nameOf(u.href) });
  return true;
}

const api = { isIos, inApp, visible, keyboard, links, open, save, sheet };
if (typeof module === 'object' && module.exports) module.exports = api;
else {
  root.Ios = api;
  if (root.addEventListener && root.document) { keyboard(root); links(root); }
}
})(typeof globalThis !== 'undefined' ? globalThis : this);
