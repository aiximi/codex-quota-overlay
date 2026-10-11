import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '../../src/core/storage.js';
import { temporaryDirectory } from './helpers.js';

test('atomic store survives reload and does not expose mutable references', (t) => {
  const directory = temporaryDirectory(t);
  const file = join(directory, 'settings.json');
  const store = new Store(file);
  store.set('settings', { language: 'en' });
  const value = store.get<{ language: string }>('settings')!;
  value.language = 'changed';
  assert.deepEqual(new Store(file).get('settings'), { language: 'en' });
  assert.deepEqual(store.get('settings'), { language: 'en' });
  store.delete('settings');
  assert.equal(new Store(file).get('settings'), undefined);
  assert.deepEqual(readdirSync(directory), ['settings.json']);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
});

test('corrupt receipts are not silently reset', (t) => {
  const file = join(temporaryDirectory(t), 'settings.json');
  writeFileSync(file, '{broken');
  assert.throws(() => new Store(file), /could not be read/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});
