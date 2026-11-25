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
//   transport.addEventListener('clipboard', { detail: { text } })   text copied on the computer's screen (never while
//                                                                    the owner only watches)
//   transport.pasteText(text, holding)   puts the text in the computer's clipboard, then presses Ctrl+V there;
//             holding() says which of Ctrl and ⌘ the owner holds (DOM codes), and the paste leaves them held
//   transport.typeText(text)    types the text key by key (any letters), resolves when the last key is sent
//
// File drop is not here: it goes by the web page's own upload route (drop.js, #1736).
import RFB from '../core/rfb.js';
import KeyTable from '../core/input/keysym.js';
import { isMac, isIOS } from '../core/util/browser.js';
import { keysymFromCodePoint } from './typing.js';

// The computer takes the text from the clipboard message and a key a moment later: the clipboard is offered, asked
// for and handed over before the Ctrl+V reaches it (extended clipboard is a round trip).
const PASTE_DELAY_MS = 250;
// Typing sends this many keys, then lets the page breathe.
const TYPE_CHUNK = 40;

// The keys a held ⌘ is on the computer. noVNC's keyboard (core/input/keyboard.js) changes ⌘ on a Mac before it sends
// it: the left one goes as Alt_L and the right one as Super_L, the way RealVNC and TigerVNC do. Anywhere else they are
// the Super keys they say. Releasing the Super keys on a Mac would leave Alt down, and the computer Alt+Ctrl+V.
const heldCommand = () => (isMac() || isIOS()
  ? [[KeyTable.XK_Alt_L, 'MetaLeft'], [KeyTable.XK_Super_L, 'MetaRight']]
  : [[KeyTable.XK_Super_L, 'MetaLeft'], [KeyTable.XK_Super_R, 'MetaRight']]);

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
    pasteText: (text, holding = () => []) => {
      if (rfb.viewOnly) return;
      rfb.clipboardPasteFrom(text);
      setTimeout(() => {
        // What the owner holds when the V goes, not when the keys were pressed: noVNC lets go of what they let go of.
        const keys = holding();
        // A ⌘ the owner holds is released first: the computer is to see Ctrl+V, with nothing else held.
        for (const [keysym, code] of heldCommand()) rfb.sendKey(keysym, code, false);
        rfb.sendKey(KeyTable.XK_Control_L, 'ControlLeft', true);
        rfb.sendKey(KeyTable.XK_v, 'KeyV');
        // Then back what the owner still holds, because noVNC's keyboard has it down and sends no second down: the
        // next key (S, A, Z) must still reach the computer with Ctrl or ⌘ held. The computer's own Ctrl stays down
        // when the owner holds it, and the owner's letting go reaches it through noVNC.
        if (!keys.some((code) => code.startsWith('Control'))) rfb.sendKey(KeyTable.XK_Control_L, 'ControlLeft', false);
        for (const [keysym, code] of heldCommand()) if (keys.includes(code)) rfb.sendKey(keysym, code, true);
      }, PASTE_DELAY_MS);
    },
    typeText: async (text) => {
      let n = 0;
      for (const ch of text.replace(/\r\n?/g, '\n')) {
        if (rfb.viewOnly) return;
        const keysym = keysymFromCodePoint(ch.codePointAt(0));
        if (keysym) rfb.sendKey(keysym, null);
        if (++n % TYPE_CHUNK === 0) await new Promise((r) => setTimeout(r, 0));
      }
    },
    disconnect: () => { try { rfb.disconnect(); } catch { /* already closed */ } },
  };
}
