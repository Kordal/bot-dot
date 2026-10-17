// The CBOR WebAuthn sends (RFC 8949): what a passkey's attestation object and public key are written in.
// Integers, byte and text strings, arrays, maps, and false, true and null. Nothing else is accepted: no
// indefinite lengths, no tags, no floats, and nothing nested deeper than WebAuthn needs.

// decode(buf, at) → { value, end }: the item that starts at `at`, and where it ends. Throws on anything else.
function decode(buf, at = 0, depth = 0) {
  if (depth > 8) throw new Error('CBOR nested too deep');
  const need = (n) => { if (at + n > buf.length) throw new Error('CBOR cut short'); };
  need(1);
  const first = buf[at++];
  const major = first >> 5;
  const info = first & 31;
  let n;
  if (info < 24) n = info;
  else if (info === 24) { need(1); n = buf[at]; at += 1; }
  else if (info === 25) { need(2); n = buf.readUInt16BE(at); at += 2; }
  else if (info === 26) { need(4); n = buf.readUInt32BE(at); at += 4; }
  else throw new Error('CBOR length not supported');
  switch (major) {
    case 0: return { value: n, end: at };
    case 1: return { value: -1 - n, end: at };
    case 2: need(n); return { value: buf.subarray(at, at + n), end: at + n };
    case 3: need(n); return { value: buf.subarray(at, at + n).toString('utf8'), end: at + n };
    case 4: {
      const list = [];
      for (let i = 0; i < n; i++) { const item = decode(buf, at, depth + 1); list.push(item.value); at = item.end; }
      return { value: list, end: at };
    }
    case 5: {
      const map = new Map();
      for (let i = 0; i < n; i++) {
        const k = decode(buf, at, depth + 1);
        const v = decode(buf, k.end, depth + 1);
        if (typeof k.value !== 'number' && typeof k.value !== 'string') throw new Error('CBOR map key not supported');
        map.set(k.value, v.value);
        at = v.end;
      }
      return { value: map, end: at };
    }
    case 7:
      if (info === 20) return { value: false, end: at };
      if (info === 21) return { value: true, end: at };
      if (info === 22) return { value: null, end: at };
      throw new Error('CBOR simple value not supported');
    default: throw new Error('CBOR type not supported');
  }
}

module.exports = { decode };
