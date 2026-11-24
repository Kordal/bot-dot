#!/usr/bin/env node
// Writes the component reference of the skill kit:ui (bot-skills/skills/ui/SKILL.md) from lib/ui-catalog.json: run it
// after a change to the catalog. `--check` changes nothing and exits 1 when the file is not current (what
// test/kit-ui.test.js checks too).
const fs = require('fs');
const path = require('path');
const { withReference } = require('../lib/ui-skill');

const FILE = path.join(__dirname, '..', 'bot-skills', 'skills', 'ui', 'SKILL.md');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'ui-catalog.json'), 'utf8'));
const now = fs.readFileSync(FILE, 'utf8');
const next = withReference(now, catalog);

if (process.argv.includes('--check')) {
  if (now !== next) { console.error('bot-skills/skills/ui/SKILL.md is not current: run node scripts/ui-skill.js'); process.exit(1); }
} else if (now !== next) {
  fs.writeFileSync(FILE, next);
  console.log('wrote bot-skills/skills/ui/SKILL.md');
} else console.log('bot-skills/skills/ui/SKILL.md is current');
