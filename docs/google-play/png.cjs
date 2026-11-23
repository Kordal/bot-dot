// The PNG facts Play checks (size, and whether it has an alpha channel), and a re-save with or without alpha, with no
// dependency: the feature graphic and the screenshots must have no alpha, and the icon must be 32-bit.
// node docs/google-play/png.cjs check <file.png>...           prints each file's size and kind, fails on a bad PNG
// node docs/google-play/png.cjs rgb|rgba <in.png> [<out.png>]  re-saves 8-bit RGB (24-bit) or RGBA (32-bit)
const fs = require('node:fs');
const zlib = require('node:zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // grey, RGB, grey + alpha, RGBA (palette PNGs are not read)

/** The header and the chunks' names of a PNG. */
function info(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  const chunks = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    chunks.push({ type: buf.toString('latin1', at + 4, at + 8), data: buf.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  const h = chunks[0].data;
  const colorType = h[9];
  return { width: h.readUInt32BE(0), height: h.readUInt32BE(4), bitDepth: h[8], colorType, interlace: h[12],
    alpha: colorType === 4 || colorType === 6 || chunks.some((c) => c.type === 'tRNS'), chunks };
}

/** The pixels as RGBA, one byte each. */
function decode(buf) {
  const i = info(buf);
  const ch = CHANNELS[i.colorType];
  if (i.bitDepth !== 8 || !ch || i.interlace) throw new Error(`unsupported PNG: depth ${i.bitDepth}, colour type ${i.colorType}, interlace ${i.interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(i.chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = i.width * ch;
  const px = Buffer.alloc(i.height * stride);
  for (let y = 0; y < i.height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const out = Buffer.alloc(i.width * i.height * 4);
  for (let p = 0; p < i.width * i.height; p++) {
    const s = p * ch;
    const [r, g, b2, al] = ch === 1 ? [px[s], px[s], px[s], 255] : ch === 2 ? [px[s], px[s], px[s], px[s + 1]] : ch === 3 ? [px[s], px[s + 1], px[s + 2], 255] : [px[s], px[s + 1], px[s + 2], px[s + 3]];
    out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b2; out[p * 4 + 3] = al;
  }
  return { width: i.width, height: i.height, rgba: out };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
};

/** A PNG of RGBA pixels, saved as RGB (alpha dropped, so every pixel must be opaque) or RGBA. */
function encode({ width, height, rgba }, withAlpha) {
  const ch = withAlpha ? 4 : 3;
  const raw = Buffer.alloc(height * (width * ch + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * ch + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = y * (width * ch + 1) + 1 + x * ch;
      if (!withAlpha && rgba[s + 3] !== 255) throw new Error(`pixel ${x},${y} is not opaque: dropping its alpha would change it`);
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
      if (withAlpha) raw[d + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = withAlpha ? 6 : 2;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Re-saves a PNG file as RGB or RGBA. */
const resave = (from, to, withAlpha) => fs.writeFileSync(to || from, encode(decode(fs.readFileSync(from)), withAlpha));

module.exports = { info, decode, encode, resave };

if (require.main === module) {
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd === 'check') {
    for (const f of files) {
      const i = info(fs.readFileSync(f));
      console.log(`${f}: ${i.width} x ${i.height}, ${i.bitDepth * CHANNELS[i.colorType]}-bit ${i.alpha ? 'with' : 'no'} alpha`);
    }
  } else if (cmd === 'rgb' || cmd === 'rgba') resave(files[0], files[1], cmd === 'rgba');
  else { console.error('usage: png.cjs check <file>... | rgb|rgba <in> [<out>]'); process.exit(2); }
}
