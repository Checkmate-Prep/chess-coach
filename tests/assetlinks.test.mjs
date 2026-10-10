// /.well-known/assetlinks.json (worker/assetlinks.js): what Android checks before the Play app opens the site full screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetLinks, FINGERPRINTS, PACKAGE } from '../worker/assetlinks.js';

const get = (method = 'GET') => assetLinks(new Request('https://checkmateprep.com/.well-known/assetlinks.json', { method }));

test('names the Android app and lets it handle the site', async () => {
  const res = get();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const [link, ...rest] = await res.json();
  assert.equal(rest.length, 0);
  assert.deepEqual(link.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(link.target.namespace, 'android_app');
  assert.equal(link.target.package_name, 'com.checkmateprep.app');
  assert.equal(PACKAGE, 'com.checkmateprep.app');
});

test('lists the Play signing key and the upload key, as SHA-256 hex pairs', async () => {
  const [link] = await get().json();
  const prints = link.target.sha256_cert_fingerprints;
  assert.equal(prints.length, 2);
  assert.deepEqual(prints, FINGERPRINTS);
  for (const p of prints) assert.match(p, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(new Set(prints).size, 2);
});

test('only answers reads', () => {
  assert.equal(get('HEAD').status, 200);
  assert.equal(get('POST').status, 404);
});
