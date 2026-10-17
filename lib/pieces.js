// A bot's outfit: its hat, a piece. A piece is a short list of plain shapes in a small box, in two tones
// of the bot's colour (docs/adr/004-pieces-as-restricted-shape-lists.md). The kit of ready hats is part
// of the figure definition (lib/figure.json), which every app draws from.
// This is the one check of a piece: the kit passes it (test/pieces.test.js), and so must any piece that
// is ever stored with a bot.
const { isDeepStrictEqual } = require('node:util');
const figure = require('./figure.json');

const KIT = figure.kit;
const SLOTS = ['hat']; // the keys of an outfit, and of the kit: a bot wears a hat and nothing else
const TONES = ['main', 'deep'];
const NAME = /^[a-z][a-z0-9-]{0,23}$/;
// What a path may be made of, and how many numbers each command takes: pairs of x and y.
const COMMANDS = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
// The numbers each shape has, besides its tones.
const FIELDS = { rect: ['x', 'y', 'w', 'h'], circle: ['cx', 'cy', 'r'], line: ['x1', 'y1', 'x2', 'y2'], path: [] };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
// What was sent, named in a refusal: only when it is a short plain word. Anything else (long text, markup,
// a value that isn't text) is never repeated back; it is "that".
const said = (v, otherwise = 'that') => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(v) ? `"${v}"` : otherwise);
const names = (slot) => Object.keys(KIT[slot].pieces);

// Why a shape isn't one, in words the Chief can act on; null when it is.
function shapeProblem(s, [w, h], limits) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'a shape is an object';
  if (typeof s.shape !== 'string' || !Object.hasOwn(FIELDS, s.shape)) return `a shape is one of ${Object.keys(FIELDS).join(', ')}`;
  const allowed = ['shape', 'fill', 'stroke', 'width', ...FIELDS[s.shape], ...(s.shape === 'rect' ? ['r'] : []), ...(s.shape === 'path' ? ['d'] : [])];
  const extra = Object.keys(s).find((k) => !allowed.includes(k));
  if (extra !== undefined) return `a ${s.shape} has no ${said(extra, 'such field')}; it has ${allowed.slice(1).join(', ')}`;
  for (const k of FIELDS[s.shape]) if (!num(s[k])) return `${k} of a ${s.shape} must be a number`;
  for (const k of ['fill', 'stroke']) if (s[k] !== undefined && !TONES.includes(s[k])) return `${k} is one of ${TONES.join(', ')}`;
  if (s.fill === undefined && s.stroke === undefined) return 'a shape needs a fill or a stroke';
  if (s.shape === 'line' && (s.fill !== undefined || s.stroke === undefined)) return 'a line has a stroke and no fill';
  if (s.stroke === undefined ? s.width !== undefined : !(num(s.width) && s.width >= limits.stroke[0] && s.width <= limits.stroke[1])) {
    return `a stroke has a width from ${limits.stroke[0]} to ${limits.stroke[1]}, and only a stroke has one`;
  }
  const inside = (x, y) => x >= 0 && x <= w && y >= 0 && y <= h;
  const outside = `outside its box (0 to ${w} across, 0 to ${h} down)`;
  if (s.shape === 'rect') {
    if (!(s.w > 0 && s.h > 0)) return 'a rect needs a width and a height above 0';
    if (!inside(s.x, s.y) || !inside(s.x + s.w, s.y + s.h)) return `a rect is ${outside}`;
    if (s.r !== undefined && !(num(s.r) && s.r >= 0 && s.r <= Math.min(s.w, s.h) / 2)) return "a rect's r is from 0 to half its shorter side";
  }
  if (s.shape === 'circle') {
    if (!(s.r > 0)) return 'a circle needs an r above 0';
    if (!inside(s.cx - s.r, s.cy - s.r) || !inside(s.cx + s.r, s.cy + s.r)) return `a circle is ${outside}`;
  }
  if (s.shape === 'line' && (!inside(s.x1, s.y1) || !inside(s.x2, s.y2))) return `a line is ${outside}`;
  if (s.shape === 'path') {
    if (!Array.isArray(s.d) || s.d.length < 2 || s.d.length > limits.commands) return `a path's d is a list of 2 to ${limits.commands} commands`;
    for (const [i, c] of s.d.entries()) {
      if (!Array.isArray(c) || typeof c[0] !== 'string' || !Object.hasOwn(COMMANDS, c[0])) return `a path command is one of ${Object.keys(COMMANDS).join(', ')}`;
      if ((i === 0) !== (c[0] === 'M')) return 'a path starts with its one M';
      if (c.length !== COMMANDS[c[0]] + 1 || !c.slice(1).every(num)) return `${c[0]} takes ${COMMANDS[c[0]]} numbers`;
      for (let j = 1; j < c.length; j += 2) if (!inside(c[j], c[j + 1])) return `a path is ${outside}`;
    }
  }
  return null;
}

// Why a piece can't be worn in that slot; null when it can.
function pieceProblem(slot, piece) {
  if (!SLOTS.includes(slot)) return 'a piece is a hat';
  const { limits } = KIT;
  if (!piece || typeof piece !== 'object' || !Array.isArray(piece.shapes)) return 'a piece has a list of shapes';
  const extra = Object.keys(piece).find((k) => k !== 'shapes' && k !== 'means');
  if (extra !== undefined) return `a piece has no ${said(extra, 'such field')}`;
  if (piece.means !== undefined && typeof piece.means !== 'string') return "a piece's means is a line of text";
  if (!piece.shapes.length || piece.shapes.length > limits.shapes) return `a piece has 1 to ${limits.shapes} shapes`;
  for (const [i, s] of piece.shapes.entries()) {
    const why = shapeProblem(s, KIT[slot].box, limits);
    if (why) return `shape ${i + 1}: ${why}`;
  }
  return null;
}

// A piece the Chief drew, as it is stored: its shapes and nothing else. Refused with the one reason it
// can't be worn, so the Chief can put that right and send it again. Nothing of it is trusted: every
// field is checked by pieceProblem, and what is kept is a plain copy of what passed.
function drawnPiece(slot, piece) {
  const extra = Object.keys(piece).find((k) => k !== 'shapes');
  const why = extra !== undefined ? `a drawn piece has only "shapes", no ${said(extra, 'other field')}` : pieceProblem(slot, piece);
  if (why) {
    const [w, h] = KIT[slot].box;
    throw new Error(`The hat you drew can't be worn: ${why}. Fix that and send outfit.${slot} again as { "shapes": [...] }: 1 to ${KIT.limits.shapes} shapes, every point from 0 to ${w} across and 0 to ${h} down.`);
  }
  // Copied value by value: numbers, tone names and command letters, and nothing an object could carry besides.
  return { shapes: Array.from(piece.shapes, (s) => Object.fromEntries(Object.keys(s).map((k) => [k, k === 'd' ? Array.from(s.d, (c) => Array.from(c)) : s[k]]))) };
}

// The outfit a bot has after a change. given: what was sent as "outfit" (undefined: nothing was).
// The hat left out, or sent as null, stays; only "" takes it off. A hat is the name of a kit hat, or
// one drawn for this bot, { shapes }. A name the kit lacks is refused with the names it has, a drawn hat
// that breaks a limit with the reason, and any other key ("holds" too: bots hold nothing any more) with
// the one key there is, so the bot keeps what it wore. A bot never given an outfit has none (null), and
// stays so when nothing is said of its hat; { hat: "" } is "no hat, on purpose".
function outfitAfter(given, existing = null) {
  existing = stored(existing);
  if (given === undefined) return existing;
  if (given === null) return existing; // "no outfit" sent back as it was read: nothing to change
  if (typeof given !== 'object' || Array.isArray(given)) throw new Error('outfit is { hat }: the name of a kit hat, a hat you draw ({ "shapes": [...] }) or "".');
  const extra = Object.keys(given).find((k) => !SLOTS.includes(k));
  if (extra !== undefined) throw new Error(`An outfit has no ${said(extra, 'such key')}. Its only key is "hat", for what the bot wears on its head: a bot is a head with a hat and holds nothing.`);
  const hat = given.hat;
  if (hat == null) return existing; // left out or null says nothing about it: a never-dressed bot stays never dressed
  if (existing && isDeepStrictEqual(hat, existing.hat)) return existing; // what it wears already stays, even if the kit or a limit has since changed
  if (typeof hat === 'object' && !Array.isArray(hat)) return { hat: drawnPiece('hat', hat) };
  if (typeof hat !== 'string' || (hat && !Object.hasOwn(KIT.hat.pieces, hat))) {
    throw new Error(`There is no hat called ${said(hat)} in the kit. outfit.hat is one of: ${names('hat').join(', ')}; or "" for none; or a hat you draw, { "shapes": [...] }.`);
  }
  return { hat };
}

// An outfit as it is kept and handed out: its hat and nothing else. A bot saved by the stick-figure
// build (never released) may still carry "holds": that is dropped here, when the bots are read. One that
// held something and wore no hat would be left with nothing, which nobody chose: it counts as never
// dressed (null), so the dresser gives it a hat.
function stored(outfit) {
  if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit)) return null;
  if (!outfit.hat && outfit.holds) return null;
  return { hat: outfit.hat || '' };
}

// The kit as the Chief reads it when it picks: every name with what it means.
const kitList = (slot) => Object.entries(KIT[slot].pieces).map(([name, p]) => `${name} (${p.means.replace(/^[^:]*: /, '')})`).join('; ');

module.exports = { KIT, SLOTS, NAME, names, pieceProblem, outfitAfter, stored, kitList };
