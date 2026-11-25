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
//
// Clipboard in and out, keys and touch are added to this surface by their own tickets (#1734 to #1736).
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
  return {
    addEventListener: (type, fn) => rfb.addEventListener(type, fn),
    setViewOnly: (on) => { rfb.viewOnly = on; },
    // Takes the keyboard, so typing goes to the computer without a click first.
    focus: () => rfb.focus(),
    disconnect: () => { try { rfb.disconnect(); } catch { /* already closed */ } },
  };
}
