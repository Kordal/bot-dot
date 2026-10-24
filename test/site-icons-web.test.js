// Site icons on the web page (#530): the host a link's icon is asked for, linkHost() cut out of public/app.js, read
// against the cases the Android app shares (test/fixtures/site-hosts.json). The page itself: test/browser/site-icons.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'site-hosts.json'), 'utf8'));
const page = vm.createContext({ URL });
vm.runInContext(`${cut('function linkHost(href)', 'function siteIcons(root)')}
  this.linkHost = linkHost;`, page);

for (const [url, host] of cases) {
  test(`web: the site of ${url}`, () => assert.equal(page.linkHost(url), host));
}
