import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { generateKey, parseKey, SecretBox, SecretBoxError } from '../src/crypto/secretBox.js';

const KEY = generateKey();

test('a sealed credential round-trips', () => {
  const box = new SecretBox(KEY);
  const sealed = box.seal('s3cret-password');
  assert.equal(box.open(sealed), 's3cret-password');
});

test('the plaintext is nowhere in the sealed bytes', () => {
  const box = new SecretBox(KEY);
  const sealed = box.seal('s3cret-password');
  assert.ok(!sealed.toString('utf8').includes('s3cret'));
  assert.ok(!sealed.toString('latin1').includes('s3cret'));
});

test('sealing the same value twice gives different bytes', () => {
  const box = new SecretBox(KEY);
  // A fresh IV each time, so identical passwords are not identifiable as such
  // by looking at the table.
  assert.notEqual(box.seal('same').toString('hex'), box.seal('same').toString('hex'));
});

test('a tampered blob fails to open rather than decrypting to garbage', () => {
  const box = new SecretBox(KEY);
  const sealed = box.seal('s3cret-password');
  const last = sealed.length - 1;
  sealed.writeUInt8(sealed.readUInt8(last) ^ 0xff, last);
  assert.throws(() => box.open(sealed), SecretBoxError);
});

test('another key cannot open it', () => {
  const sealed = new SecretBox(KEY).seal('s3cret-password');
  assert.throws(() => new SecretBox(generateKey()).open(sealed), /wrong key or corrupted/);
});

test('keys are accepted as base64 or hex, and rejected otherwise', () => {
  assert.equal(parseKey(generateKey()).length, 32);
  assert.equal(parseKey('a'.repeat(64)).length, 32);
  assert.throws(() => parseKey(''), /not configured/);
  assert.throws(() => parseKey('too-short'), /must be 32 bytes/);
});

test('matches compares without revealing the plaintext', () => {
  const box = new SecretBox(KEY);
  const sealed = box.seal('correct');
  assert.equal(box.matches(sealed, 'correct'), true);
  assert.equal(box.matches(sealed, 'wrong'), false);
  assert.equal(box.matches(Buffer.from('nonsense'), 'correct'), false);
});
