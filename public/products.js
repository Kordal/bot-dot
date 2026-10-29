// ---------- product cards (#682, ADR 113) ----------

// Shopping results in a reply: a ```products fence holds a JSON list, and the chat draws it as product cards, the first
// product as the bot's pick (a large card with its photo, price, rating, why, Open and Save), the rest as rows under
// it. Read by the rules both apps share (test/fixtures/products-cases.json; Android draws it in its own ticket): a fence that can't
// be read stays its code. Every word is drawn as text; only an https address opens; a photo comes through botdot
// (/api/product-image), never from the store itself. Save puts the product among the bot's files.
const Products = (() => {
  const MAX = 10;
  const str = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const https = (v) => { const s = str(v, 2000); return /^https:\/\/[^\s/?#]+\S*$/.test(s) ? s : ''; };
  // A number, or a text that is one; anything else is none.
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);

  // A price's number: "€1.299" 1299, "379,99 zł" 379.99, "$1,299.00" 1299; NaN without digits. A separator followed by
  // one or two digits at the number's end is its decimal point; any other is a thousands separator.
  function amount(text) {
    const m = String(text ?? '').match(/\d[\d\s.,'  ]*/);
    if (!m) return NaN;
    const t = m[0].replace(/[\s'  ]/g, '').replace(/[.,]+$/, '');
    const dec = t.match(/^(.*\d)[.,](\d{1,2})$/);
    return dec ? Number(`${dec[1].replace(/[.,]/g, '')}.${dec[2]}`) : Number(t.replace(/[.,]/g, ''));
  }

  // How much less than it was, in whole percent: 15 for €339 that was €399; 0 when it is not less.
  function off(price, was) {
    const p = amount(price), w = amount(was);
    if (!(p > 0) || !(w > p)) return 0;
    return Math.round((1 - p / w) * 100);
  }

  // The products a fence holds, or null when it can't be drawn: a list (or one product) of objects with a name;
  // what isn't one is left out, and at most MAX are kept.
  function parse(text) {
    let v;
    try { v = JSON.parse(text); } catch { return null; }
    const list = (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []).flatMap((p) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
      const name = str(p.name, 120);
      if (!name) return [];
      const rating = num(p.rating);
      const reviews = num(p.reviews);
      const price = str(p.price, 30), was = str(p.was, 30);
      return [{
        name,
        url: https(p.url),
        image: https(p.image),
        price,
        was: off(price, was) ? was : '',
        off: off(price, was),
        store: str(p.store, 60),
        rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
        reviews: Number.isFinite(reviews) && reviews >= 1 ? Math.floor(reviews) : null,
        arrives: str(p.arrives, 60),
        why: str(p.why, 200),
      }];
    }).slice(0, MAX);
    return list.length ? list : null;
  }

  const ICON = {
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  };

  const photo = (p) => `<span class="pc-img">${ICON.bag}${p.image ? `<img alt="" loading="lazy" decoding="async" src="/api/product-image?url=${esc(encodeURIComponent(p.image))}">` : ''}</span>`;
  const price = (p) => `<span class="pc-price"><b>${esc(p.price)}</b>${p.was ? `<s>${esc(p.was)}</s>` : ''}${p.off ? `<em>−${p.off}%</em>` : ''}</span>`;
  const rowPrice = (p) => `<span class="pc-price"><b>${esc(p.price)}</b>${p.off ? `<em>−${p.off}%</em>` : ''}</span>`;
  // "★ 4.6 · 2 140 reviews · amazon.de", and the delivery after it in a row.
  const facts = (p, arrives) => {
    const bits = [
      p.rating != null ? `<span class="pc-star">${ICON.star}${p.rating.toFixed(1)}</span>` : '',
      p.reviews != null ? esc(trn(p.reviews, '{n} review', '{n} reviews')) : '',
      p.store ? esc(p.store) : '',
      arrives && p.arrives ? esc(p.arrives) : '',
    ].filter(Boolean);
    return bits.length ? `<span class="pc-facts">${bits.join('<i></i>')}</span>` : '';
  };
  const link = (p) => (p.url ? `href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" data-site-icon` : '');

  // The cards. botId: the bot whose reply it is, for Save; none in the Chief's chat or on a page.
  function html(list, botId = '') {
    const [pick, ...rest] = list;
    const save = botId && pick.url
      ? `<button type="button" class="pc-btn" data-product-save="${esc(botId)}" data-product="${esc(JSON.stringify({ name: pick.name, url: pick.url, price: pick.price, store: pick.store }))}" aria-pressed="${saved(botId).has(pick.url)}">${ICON.save}<span>${(saved(botId).has(pick.url) ? tr('Saved') : tr('Save'))}</span></button>`
      : '';
    const card = `<div class="pc-pick">${photo(pick)}<div class="pc-t">
      <span class="pc-name">${esc(pick.name)}</span>${pick.price ? price(pick) : ''}${facts(pick, false)}
      ${pick.why ? `<p class="pc-why">${esc(pick.why)}</p>` : ''}${pick.arrives ? `<span class="pc-ship">${esc(pick.arrives)}</span>` : ''}
      ${pick.url || save ? `<div class="pc-acts">${pick.url ? `<a class="pc-btn pri" ${link(pick)}>${ICON.open}<span>${tr('Open')}</span></a>` : ''}${save}</div>` : ''}
    </div></div>`;
    const rows = rest.map((p) => {
      const inner = `${photo(p)}<span class="pc-t"><span class="pc-name">${esc(p.name)}</span>${facts(p, true)}</span>${p.price ? rowPrice(p) : ''}${p.url ? `<span class="pc-go">${ICON.open}</span>` : ''}`;
      return p.url ? `<a class="pc-row" ${link(p)} title="${esc(p.name)}">${inner}</a>` : `<div class="pc-row">${inner}</div>`;
    }).join('');
    return `<div class="products">${card}${rows ? `<div class="pc-list">${rows}</div>` : ''}</div>`;
  }

  // What each bot has saved, by address: asked once per bot, then kept as Save changes it.
  const savedOf = new Map();
  function saved(botId) {
    if (!savedOf.has(botId)) {
      savedOf.set(botId, new Set());
      if (typeof api === 'function') {
        api(`/bots/${encodeURIComponent(botId)}/saved-products`).then((r) => {
          const set = savedOf.get(botId);
          for (const u of r?.urls || []) set.add(u);
          if (set.size) $$(`[data-product-save="${CSS.escape(botId)}"]`).forEach(mark);
        }).catch(() => {});
      }
    }
    return savedOf.get(botId);
  }
  function mark(btn) {
    let p;
    try { p = JSON.parse(btn.dataset.product); } catch { return; }
    const on = saved(btn.dataset.productSave).has(p.url);
    btn.setAttribute('aria-pressed', String(on));
    $('span', btn).textContent = on ? tr('Saved') : tr('Save');
  }

  // Save, and a photo that can't be had: wherever a reply is drawn.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('[data-product-save]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      let p;
      try { p = JSON.parse(btn.dataset.product); } catch { return; }
      const botId = btn.dataset.productSave;
      const set = saved(botId);
      const on = !set.has(p.url);
      if (on) set.add(p.url); else set.delete(p.url);
      $$(`[data-product-save="${CSS.escape(botId)}"]`).forEach(mark);
      try { await api(`/bots/${encodeURIComponent(botId)}/saved-products`, { method: 'POST', body: { product: p, saved: on } }); } catch (err) {
        if (on) set.delete(p.url); else set.add(p.url);
        $$(`[data-product-save="${CSS.escape(botId)}"]`).forEach(mark);
        if (typeof toast === 'function') toast(err.message, true);
      }
    });
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (img?.tagName === 'IMG' && img.parentElement?.classList.contains('pc-img')) img.remove();
    }, true);
  }

  return { parse, html, amount, off, MAX };
})();
