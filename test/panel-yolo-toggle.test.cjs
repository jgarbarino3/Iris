const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Panel runtime row labels runtime command access without conflating document edits', () => {
  const panelPath = path.join(__dirname, '..', 'src', 'iso', 'panel', 'Panel.tsx');
  const contents = fs.readFileSync(panelPath, 'utf8');

  assert.match(contents, /role=\"switch\"/);
  assert.match(contents, /Tools: Auto/);
  assert.match(contents, /Tools: Ask/);
  assert.match(contents, /Document edits: Review every change/);
  assert.match(contents, /claudeYoloMode/);
  assert.doesNotMatch(contents, />YOLO</);
  assert.doesNotMatch(contents, /YOLO mode/);
});
