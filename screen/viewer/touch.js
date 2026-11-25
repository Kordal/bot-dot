// The screen by touch (#1735, ADR 279): a tap clicks, holding is a right click, one finger drags, two fingers scroll,
// and a pinch zooms the picture and moves it (a zoomed picture is also moved by one finger). It sits on the transport's
// pointer surface, so it knows nothing of RFB; a viewer that only watches sends nothing (the transport refuses), but
// can still zoom and move the picture.
//
// The picture is drawn in `layer`, which fills `screen` at zoom 1 and is made larger and moved to zoom: the RFB client
// sees an element that changed size and scales the picture to it, so its own pixel arithmetic stays right.
const MAX_ZOOM = 5;
const SLOP = 10; // px a finger may wander and still be a tap or a hold
const HOLD_MS = 500;
const SCROLL = 1.5; // wheel pixels per pixel a pair of fingers moves

export function setupTouch({ screen, layer, transport }) {
  let zoom = 1, ox = 0, oy = 0;
  let mode = 'none'; // none | tap | held | drag | pan | two | scroll | pinch | ignore
  let start = null, last = null, lastCentre = null, lastGap = 0, startCentre = null, startGap = 0, hold = null;

  const gap = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const centre = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

  // The layer's size and place: a zoom of z is z times the screen, moved by (ox, oy) but never off the screen.
  function place() {
    const w = screen.clientWidth, h = screen.clientHeight;
    ox = Math.min(0, Math.max(ox, w - w * zoom));
    oy = Math.min(0, Math.max(oy, h - h * zoom));
    layer.style.width = `${zoom * 100}%`;
    layer.style.height = `${zoom * 100}%`;
    layer.style.left = `${ox}px`;
    layer.style.top = `${oy}px`;
    transport()?.refit();
  }
  addEventListener('resize', place);

  // Zoom to z, keeping the point under (x, y) where it is.
  function zoomAt(z, x, y) {
    const r = screen.getBoundingClientRect();
    const px = (x - r.left - ox) / zoom, py = (y - r.top - oy) / zoom;
    zoom = Math.min(MAX_ZOOM, Math.max(1, z));
    ox = x - r.left - px * zoom;
    oy = y - r.top - py * zoom;
    place();
  }

  const stopHold = () => { clearTimeout(hold); hold = null; };
  const click = (t, button) => { transport().pointerMove(t.x, t.y); transport().pointerDown(t.x, t.y, button); transport().pointerUp(t.x, t.y, button); };
  const release = () => { if (mode === 'drag') transport().pointerUp(last.x, last.y, 0); };

  function onStart(ev) {
    if (!mine(ev)) return;
    own(ev);
    const n = ev.touches.length;
    if (n === 1) {
      const t = ev.touches[0];
      start = last = { x: t.clientX, y: t.clientY };
      mode = 'tap';
      stopHold();
      hold = setTimeout(() => { if (mode === 'tap') { mode = 'held'; click(start, 2); } }, HOLD_MS);
    } else if (n === 2) {
      stopHold();
      release();
      const [a, b] = ev.touches;
      mode = 'two';
      startCentre = lastCentre = centre(a, b);
      startGap = lastGap = gap(a, b);
    } else {
      stopHold();
      release();
      mode = 'ignore';
    }
  }

  function onMove(ev) {
    if (!mine(ev) || mode === 'none') return;
    own(ev);
    if (ev.touches.length === 1 && ['tap', 'drag', 'pan'].includes(mode)) {
      const t = ev.touches[0], now = { x: t.clientX, y: t.clientY };
      if (mode === 'tap') {
        if (Math.hypot(now.x - start.x, now.y - start.y) < SLOP) return;
        stopHold();
        if (zoom > 1) mode = 'pan';
        else {
          mode = 'drag';
          transport().pointerMove(start.x, start.y);
          transport().pointerDown(start.x, start.y, 0);
        }
      }
      if (mode === 'drag') transport().pointerMove(now.x, now.y);
      else { ox += now.x - last.x; oy += now.y - last.y; place(); }
      last = now;
    } else if (ev.touches.length === 2 && ['two', 'scroll', 'pinch'].includes(mode)) {
      const [a, b] = ev.touches, c = centre(a, b), g = gap(a, b);
      if (mode === 'two') {
        // Whichever of the two goes first: the fingers coming together or apart is a pinch, moving together a scroll.
        if (Math.abs(g - startGap) > SLOP * 1.5) mode = 'pinch';
        else if (Math.hypot(c.x - startCentre.x, c.y - startCentre.y) > SLOP) mode = 'scroll';
        else return;
      }
      if (mode === 'pinch') {
        zoomAt(zoom * (g / lastGap), lastCentre.x, lastCentre.y);
        ox += c.x - lastCentre.x; oy += c.y - lastCentre.y; // the pinch's own centre moves the picture
        place();
      } else {
        // Fingers moving up read further down: the page goes with them.
        transport().scroll(c.x, c.y, -(c.x - lastCentre.x) * SCROLL, -(c.y - lastCentre.y) * SCROLL);
      }
      lastCentre = c; lastGap = g;
    }
  }

  function onEnd(ev) {
    if (!mine(ev)) return;
    own(ev);
    stopHold();
    if (ev.type === 'touchend' && mode === 'tap' && ev.touches.length === 0) click(start, 0);
    if (ev.type === 'touchcancel' || ev.touches.length === 0) release();
    if (mode === 'pinch' && zoom < 1.05) zoomAt(1, lastCentre.x, lastCentre.y);
    // A finger lifted out of a gesture ends it: the rest of its fingers do nothing until all are up.
    mode = ev.touches.length === 0 ? 'none' : 'ignore';
  }

  // The RFB client puts a catching layer over the page while a mouse button is down: a touch on it is still ours.
  // Ours alone: the RFB client has gestures of its own on the picture, which must not also act, and no emulated mouse
  // events may follow the touch.
  const own = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  const mine = (ev) => ev.target.closest?.('#screen, #noVNC_mouse_capture_elem');
  const opts = { capture: true, passive: false };
  document.addEventListener('touchstart', onStart, opts);
  document.addEventListener('touchmove', onMove, opts);
  document.addEventListener('touchend', onEnd, opts);
  document.addEventListener('touchcancel', onEnd, opts);
  return { zoomOut: () => { zoom = 1; ox = oy = 0; place(); } };
}
