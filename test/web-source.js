// The web page's own code (#77): public/app.js and the files split out of it, from app.js to boot.js in the order
// index.html loads them, joined into one text as app.js was, a blank line between them. The tests read it where they
// read app.js before: they cut parts out of it by name, or run it whole against stand-ins.
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// The page's own files, as index.html loads them.
function webFiles() {
  const loaded = [...read('index.html').matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  const from = loaded.indexOf('app.js'), to = loaded.indexOf('boot.js');
  if (from < 0 || to < from) throw new Error('index.html loads app.js, then boot.js');
  return loaded.slice(from, to + 1);
}

let text = null;
const webSource = () => (text ??= webFiles().map(read).join('\n'));

module.exports = { webSource, webFiles };
