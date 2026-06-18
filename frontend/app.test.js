const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatTable } = require('./app.js');

test('renders header, separator, rows and a row count', () => {
  const out = formatTable(['id', 'name'], [{ id: 1, name: 'a' }, { id: 2, name: 'bb' }]);
  assert.match(out, /id\s+\|\s+name/);
  assert.match(out, /\(2 rows\)/);
});

test('pads columns to align', () => {
  const out = formatTable(['n'], [{ n: 'x' }, { n: 'yyyy' }]);
  // header "n" padded to width of "yyyy"
  assert.match(out, /^n {3}/m);
});

test('handles no columns', () => {
  assert.equal(formatTable([], []), '(0 rows)');
});
