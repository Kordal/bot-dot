// The viewer's first transport: noVNC's RFB client (vendor/novnc/core, unchanged) over the WebSocket botdot passes on
// to the computer's VNC server (ADR 279). The viewer page knows a transport only by this small surface, so a video
// transport can be added behind the same page later:
//
//   createTransport({ target, url, viewOnly }) -> transport
//     target    the element the picture is drawn in (the transport draws and scales it)
//     url       where it connects (a ws: or wss: address)
//     viewOnly  true: the mouse and keys never reach the computer
//   transport.addEventListener('connect')               the picture is coming
//   transport.addEventListener('disconnect', { detail: { clean } })   it ended, or never came
//   transport.setViewOnly(boolean)
//   transport.disconnect()
//   transport.refit()   the element the picture is in changed size: scale the picture to it now
//   transport.pointerMove(x, y) / pointerDown(x, y, button) / pointerUp(x, y, button)
//             the pointer at a point of the page (client pixels); button 0 left, 1 middle, 2 right (touch, #1735)
//   transport.scroll(x, y, dx, dy)   a wheel turn at that point, in pixels
//   transport.key(keysym, code, down)   one key going down or up (X keysym, DOM key code)
//
// Clipboard in and out and file drop are added to this surface by their own tickets (#1734, #1736).
import RFB from '../core/rfb.js';

export function createTransport({ target, url, viewOnly }) {
  const rfb = new RFB(target, url, { shared: true });
  // Scaling and quality are botdot's to choose, not the owner's: the whole picture, whatever size the desktop is.
  rfb.scaleViewport = true;
  rfb.clipViewport = false;
  rfb.resizeSession = false;
  rfb.showDotCursor = true;
  rfb.background = getComputedStyle(document.body).backgroundColor;
  rfb.qualityLevel = 6;
  rfb.compressionLevel = 2;
  rfb.viewOnly = viewOnly;
  // The computer's screen has no password: one asked for is a screen that isn't ours, which ends as any failed try.
  rfb.addEventListener('credentialsrequired', () => rfb.disconnect());
  // The pointer from touch goes in as the mouse events the RFB client already turns into the desktop's own pixels,
  // wherever the picture is scaled or moved to; it never takes the focus from the typing field (focusOnClick).
  const canvas = () => target.querySelector('canvas');
  const mouse = (type, x, y, button = 0) => {
    const c = canvas();
    if (!c) return;
    // While a button is down the RFB client holds the mouse (setCapture) and wants the events at the window, as a real
    // mouse's are, and lets go of it on the mouseup it sees there.
    const at = document.captureElement && type !== 'mousedown' ? window : c;
    const focusOnClick = rfb.focusOnClick;
    rfb.focusOnClick = false;
    try { at.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true })); } finally { rfb.focusOnClick = focusOnClick; }
  };
  return {
    // The RFB client watches its element's size, but a change made and undone within a frame can slip past it.
    refit: () => { rfb.scaleViewport = true; },
    pointerMove: (x, y) => mouse('mousemove', x, y),
    pointerDown: (x, y, button = 0) => mouse('mousedown', x, y, button),
    pointerUp: (x, y, button = 0) => mouse('mouseup', x, y, button),
    scroll: (x, y, dx, dy) => canvas()?.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true })),
    key: (keysym, code, down) => rfb.sendKey(keysym, code, down),
    addEventListener: (type, fn) => rfb.addEventListener(type, fn),
    setViewOnly: (on) => { rfb.viewOnly = on; },
    // Takes the keyboard, so typing goes to the computer without a click first.
    focus: () => rfb.focus(),
    disconnect: () => { try { rfb.disconnect(); } catch { /* already closed */ } },
  };
}
