// A value picked out of an answer: "state", "attributes.temperature", "0.name", "items[].summary".
function pickValue(data, pick) {
  if (!pick) return data;
  let out = data;
  const parts = pick.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (out == null) return undefined;
    if (p.endsWith('[]')) {
      const list = p === '[]' ? out : out[p.slice(0, -2)];
      if (!Array.isArray(list)) return undefined;
      const rest = parts.slice(i + 1).join('.');
      return list.map((x) => pickValue(x, rest));
    }
    out = out[p];
  }
  return out;
}

module.exports = { pickValue };
