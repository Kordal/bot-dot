// The key that types one character (an X keysym, which the computer's VNC server turns into the right key press,
// with Shift where the letter needs it). Latin-1 characters are their own keysym; every other letter, Polish ones
// included, is its Unicode code point plus 0x01000000. Enter and Tab are the keys of those names; other control
// characters type nothing.
export function keysymFromCodePoint(cp) {
  if (cp === 10) return 0xff0d; // Return
  if (cp === 9) return 0xff09; // Tab
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x100) return cp;
  return 0x01000000 + cp;
}
