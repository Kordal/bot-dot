// A product card in a reply (#682, ADR 113): its photo, GET /api/product-image?url=<https address>, fetched and kept
// by botdot (lib/product-image.js; 404 when there is none botdot keeps: the apps then draw their own placeholder), and
// its Save, GET and POST /api/bots/:id/saved-products, a line in a file among the bot's files (lib/saved-products.js).
// The owner's alone (not in CHIEF_ROUTES).
const path = require('path');
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const productImage = require('../product-image');
const saved = require('../saved-products');

function create() {
  const photos = productImage.create({ dir: path.join(B.DATA_DIR, 'product-images') });
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] === 'product-image' && !parts[1] && m === 'GET') {
      const at = productImage.imageUrl(url.searchParams.get('url'));
      if (!at) return send(res, 400, { error: 'Give a photo\'s https address at a public site.' });
      const { image, again } = await photos.image(at);
      // The browser and the phone keep the answer too, so a chat drawn again asks nothing; a store that did not
      // answer, only for a few minutes.
      const keep = `private, max-age=${Math.round((image ? productImage.KEEP_MS : again ? productImage.AGAIN_MS : productImage.MISS_MS) / 1000)}`;
      if (!image) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': keep });
        return res.end(JSON.stringify({ error: 'botdot keeps no photo at that address.' }));
      }
      res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.body.length, 'Cache-Control': keep, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" });
      return res.end(image.body);
    }
    if (parts[0] === 'bots' && parts[2] === 'saved-products' && parts.length === 3 && (m === 'GET' || m === 'POST')) {
      const bot = B.bots.get(parts[1]);
      if (!bot) return send(res, 404, { error: 'No such bot.' });
      const ws = path.join(B.WORKSPACES_DIR, bot.id);
      if (m === 'GET') return send(res, 200, { urls: saved.list(ws) });
      const body = await readBody(req);
      return send(res, 200, saved.set(ws, body?.product, body?.saved !== false));
    }
    return NEXT;
  };
}

module.exports = { create };
