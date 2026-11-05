// The desktop app's windows leave drag and drop to the page: Tauri's own handler, on by default, takes every drag on
// macOS and Windows, so a bot's key could not be moved and a file could not be dropped onto a chat there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test("every desktop window turns Tauri's drag and drop handler off", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const guarded = src.slice(src.indexOf('fn guarded'), src.indexOf('.on_page_load', src.indexOf('fn guarded')));
  assert.match(guarded, /\.disable_drag_drop_handler\(\)/);
  // Every window, the main one and those a page opens, is built through guarded().
  const built = [...src.matchAll(/WebviewWindowBuilder::new\(/g)].length;
  const through = [...src.matchAll(/guarded\(&[a-z_]+, builder\)\.build\(\)/g)].length;
  assert.equal(through, built);
});
