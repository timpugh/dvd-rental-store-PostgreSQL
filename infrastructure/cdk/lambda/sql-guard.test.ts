import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSql, validateReadOnly } from './sql-guard';

test('extractSql pulls SQL out of a fenced code block', () => {
  assert.equal(extractSql('Here:\n```sql\nSELECT 1\n```'), 'SELECT 1');
});

test('extractSql trims a trailing semicolon and whitespace', () => {
  assert.equal(extractSql('  SELECT 1 ;  '), 'SELECT 1');
});

test('appends LIMIT 100 when none is present', () => {
  const r = validateReadOnly('SELECT * FROM film');
  assert.equal(r.ok, true);
  assert.match(r.sql!, /LIMIT 100$/);
});

test('keeps an existing LIMIT', () => {
  const r = validateReadOnly('SELECT * FROM film LIMIT 5');
  assert.equal(r.sql, 'SELECT * FROM film LIMIT 5');
});

test('allows a WITH (CTE) query', () => {
  assert.equal(validateReadOnly('WITH x AS (SELECT 1) SELECT * FROM x').ok, true);
});

test('rejects DELETE', () => {
  assert.equal(validateReadOnly('DELETE FROM customer').ok, false);
});

test('rejects stacked statements', () => {
  assert.equal(validateReadOnly('SELECT 1; DROP TABLE film').ok, false);
});
