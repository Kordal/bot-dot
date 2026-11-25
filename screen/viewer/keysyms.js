// The X keysyms and DOM key codes the viewer sends (what noVNC's sendKey takes).
export const KEY = {
  Control: [0xffe3, 'ControlLeft'], Alt: [0xffe9, 'AltLeft'], Super: [0xffeb, 'MetaLeft'],
  Delete: [0xffff, 'Delete'], Escape: [0xff1b, 'Escape'], Tab: [0xff09, 'Tab'], L: [0x6c, 'KeyL'],
  Enter: [0xff0d, 'Enter'], Backspace: [0xff08, 'Backspace'],
  ArrowLeft: [0xff51, 'ArrowLeft'], ArrowUp: [0xff52, 'ArrowUp'], ArrowRight: [0xff53, 'ArrowRight'], ArrowDown: [0xff54, 'ArrowDown'],
  Home: [0xff50, 'Home'], End: [0xff57, 'End'], PageUp: [0xff55, 'PageUp'], PageDown: [0xff56, 'PageDown'],
};

// The keysym of a typed character: Latin-1 is its own code, any other character is 0x01000000 + its code point.
export const keysymOf = (char) => {
  const cp = char.codePointAt(0);
  if (cp === 10 || cp === 13) return KEY.Enter[0];
  if (cp === 9) return KEY.Tab[0];
  return cp < 0x100 ? cp : 0x01000000 + cp;
};
