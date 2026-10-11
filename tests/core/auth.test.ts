import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { getAccountKey, readCredentials } from '../../src/core/auth.js';
import { credentials, temporaryDirectory } from './helpers.js';

test('auth reads only the selected account and verifies its token account claim', async (t) => {
  const directory = temporaryDirectory(t);
  const expected = credentials();
  writeFileSync(
    join(directory, 'auth.json'),
    JSON.stringify({
      tokens: { account_id: expected.accountID, access_token: expected.token },
    }),
  );
  assert.deepEqual(await readCredentials(directory), expected);
  assert.equal(await getAccountKey(directory), expected.accountKey);
  writeFileSync(
    join(directory, 'auth.json'),
    JSON.stringify({
      tokens: { account_id: 'other-account', access_token: expected.token },
    }),
  );
  await assert.rejects(readCredentials(directory), /Sign in/);
  assert.equal(await getAccountKey(directory), null);
});

test('malformed and missing authentication exposes no raw file contents', async (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(await getAccountKey(directory), null);
  writeFileSync(join(directory, 'auth.json'), '{private-invalid-content');
  await assert.rejects(readCredentials(directory), (error: Error) => {
    assert.equal(error.message.includes('private-invalid-content'), false);
    return true;
  });
});
