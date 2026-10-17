const fs = require('node:fs');
const LIMIT = 256 * 1024 * 1024;
const tooLarge = () => Object.assign(new Error('Backup exceeds 256 MB'), { status: 413 });
function save(req, file) {
  if (Number(req.headers['content-length']) > LIMIT) { req.resume(); return Promise.reject(tooLarge()); }
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file, { mode: 0o600, flags: 'wx' });
    let size = 0, failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out); req.resume();
      out.destroy();
      out.once('close', () => { fs.rmSync(file, { force: true }); reject(error); });
    };
    req.on('data', (chunk) => { size += chunk.length; if (size > LIMIT) fail(tooLarge()); });
    req.on('aborted', () => fail(new Error('Backup upload aborted')));
    req.on('error', fail); out.on('error', fail);
    out.on('finish', () => { if (!failed) resolve(); });
    req.pipe(out);
  });
}
module.exports = { save };
