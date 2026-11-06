// A live feed that knows when it is dead (#1078): botdot pings with a real event, and the web page opens its feed
// again when it has been quiet too long, the network came back, or the page is shown again after a quiet spell.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('vm');
const FeedWatch = require('../public/feed-watch');
const { cut } = require('./web-page');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const apiDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api.md'), 'utf8');

test('server: the live feed pings with an event a browser sees, not a comment, and without an id', () => {
  assert.match(server, /setInterval\(\(\) => res\.write\('event: ping\\ndata: \{\}\\n\\n'\), 20_000\)/);
  assert.doesNotMatch(server, /res\.write\(': ping\\n\\n'\), 20_000\)/);
  assert.match(apiDoc, /`event: ping`/, 'docs/api.md says so');
});

test('a quiet feed is opened again from the last event it had; a feed that speaks is left alone', () => {
  let t = 0;
  const opened = [];
  const closed = [];
  let heard;
  const w = FeedWatch.keeper((since, h) => { heard = h; const es = { since, close: () => closed.push(since) }; opened.push(es); return es; }, { now: () => t });
  assert.equal(w.check(), false, 'nothing open yet: nothing to do');
  w.start();
  assert.deepEqual(opened.map((e) => e.since), [null]);
  t = 30_000; heard({ lastEventId: 'a.1' });
  t = 60_000; heard({ type: 'ping', lastEventId: '' }); // a ping has no id: the last one stays
  t = 100_000;
  assert.equal(w.check(), false, '40 s since the ping');
  t = 106_000;
  assert.equal(w.check(), true, 'quiet for 46 s');
  assert.deepEqual(opened.map((e) => e.since), [null, 'a.1'], 'from the last event it had: nothing is missed');
  assert.deepEqual(closed, [null], 'the old one is closed');
  assert.equal(w.check(), false, 'the new one has just opened');
  assert.equal(FeedWatch.url('a.1'), '/api/events?guarded=1&since=a.1');
  assert.equal(FeedWatch.url(null), '/api/events?guarded=1');
  assert.ok(FeedWatch.QUIET_MS > 2 * 20_000, 'two pings may be missed');
});

// followFeed (public/feed.js) run against a stand-in browser.
function page() {
  const feeds = [];
  const on = {};
  const ticks = [];
  let now = 0;
  class EventSource {
    constructor(url) { this.url = url; this.heard = {}; this.closed = false; feeds.push(this); }
    addEventListener(type, fn) { (this.heard[type] ||= []).push(fn); }
    close() { this.closed = true; }
    say(type, data = {}, id = '') { (this.heard[type] || []).forEach((fn) => fn({ data: JSON.stringify(data), lastEventId: id })); }
  }
  const groups = [];
  const ctx = vm.createContext({
    window: { EventSource: true }, EventSource, state: {}, setTimeout: () => 0, clearTimeout() {},
    setInterval: (fn) => ticks.push(fn), refresh() {}, setAway() {}, $: () => ({ open: false }),
    document: { hidden: false, addEventListener: (type, fn) => { (on[type] ||= []).push(fn); } },
    addEventListener: (type, fn) => { (on[type] ||= []).push(fn); },
    followGroups: (es) => groups.push(es),
    FeedWatch: { ...FeedWatch, keeper: (open) => FeedWatch.keeper(open, { now: () => now }) },
    JSON, Date,
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  return { ctx, feeds, on, ticks, groups, at: (t) => { now = t; } };
}

test('web: a feed quiet for 45 s is opened again, every listener on it, the groups too, and from where it was', () => {
  const p = page();
  assert.equal(p.feeds.length, 1);
  assert.equal(p.feeds[0].url, '/api/events?guarded=1');
  assert.ok(p.feeds[0].heard.ping, 'the ping is heard');
  assert.deepEqual(p.groups, [p.feeds[0]], 'the groups follow the feed (groups.js)');
  assert.equal(p.ticks.length, 1, 'it looks every few seconds');
  p.at(10_000); p.feeds[0].say('bots', {}, 'k.7');
  p.at(30_000); p.feeds[0].say('ping');
  p.at(70_000); p.ticks[0]();
  assert.equal(p.feeds.length, 1, 'a ping 40 s ago: alive');
  p.at(80_000); p.ticks[0]();
  assert.equal(p.feeds.length, 2, 'quiet for 50 s: opened again');
  assert.ok(p.feeds[0].closed);
  assert.equal(p.feeds[1].url, '/api/events?guarded=1&since=k.7');
  assert.equal(p.ctx.state.feed, p.feeds[1]);
  assert.deepEqual(Object.keys(p.feeds[1].heard).sort(), Object.keys(p.feeds[0].heard).sort(), 'the same listeners');
  assert.deepEqual(p.groups, [p.feeds[0], p.feeds[1]]);
  assert.equal(typeof p.feeds[1].onopen, 'function', 'its opening reads everything again');
});

test('web: back online, the feed is opened again at once; shown again, only when it was quiet', () => {
  const p = page();
  p.on.online.forEach((fn) => fn());
  assert.equal(p.feeds.length, 2, 'the network came back');
  p.at(20_000);
  p.on.visibilitychange.forEach((fn) => fn());
  assert.equal(p.feeds.length, 2, 'shown again, and the feed spoke recently');
  p.at(60_000);
  p.on.visibilitychange.forEach((fn) => fn());
  assert.equal(p.feeds.length, 3, 'shown again after a quiet minute (a laptop that slept)');
});
