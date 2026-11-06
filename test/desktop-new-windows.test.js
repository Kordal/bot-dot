// A `target="_blank"` link in the desktop app ("Open as document", a file, another site) reaches the window's
// on_new_window handler: the opener plugin's own click script, on by default, took it first and asked the app over
// IPC, which the front door's page may not use, so the link did nothing on macOS and Windows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the opener plugin leaves link clicks to the page', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.doesNotMatch(src, /tauri_plugin_opener::init\(\)/);
  assert.match(src, /tauri_plugin_opener::Builder::new\(\)\.open_js_links_on_click\(false\)\.build\(\)/);
  assert.match(src, /\.on_new_window\(/);
});
