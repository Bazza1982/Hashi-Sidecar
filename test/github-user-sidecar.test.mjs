import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueue, processPending, readReply, validateConfig } from '../scripts/github-user-sidecar.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hub-github-sidecar-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { schemaVersion: 1, installationId: 'ff00599c-abcd-4b33-9111-00ee66aa44bb',
    root, userSid: 'S-1-5-21-11-22-33-1001', expectedGitHubLogin: 'operator', taskName: 'HashiHubV2-GitHubRead-test',
    taskPath: '\\', userProfile: root, ghPath: process.execPath, gitPath: process.execPath,
    workerPath: join(root, 'worker.mjs'), workerSHA256: 'a'.repeat(64), repositories: ['example/one'] };
  for (const name of ['queue', 'responses', 'sources', 'hooks']) mkdirSync(join(root, name));
  return { root, config, reply: id => join(root, 'responses', id + '.json') };
}

test('GitHub sidecar persists a scoped request and result across caller restarts', async t => {
  const f = fixture(t), request = enqueue(f.config, { operation: 'main', repo: 'example/one' });
  let calls = 0;
  await processPending(f.config, { observedSid: f.config.userSid, execute: async r => {
    calls++; assert.equal(r.repo, 'example/one');
    return { sha: 'b'.repeat(40), private: true };
  } });
  const reopened = JSON.parse(JSON.stringify(f.config));
  const reply = readReply(reopened, request);
  assert.equal(reply.ok, true); assert.equal(reply.data.sha, 'b'.repeat(40));
  assert.equal(reply.observedUserSid, f.config.userSid); assert.equal(calls, 1);
  assert.equal(existsSync(join(f.root, 'queue', request.id + '.json')), false);
  writeFileSync(join(f.root, 'queue', request.id + '.json'), JSON.stringify(request));
  await processPending(reopened, { observedSid: reopened.userSid, execute: async () => { calls++; } });
  assert.equal(calls, 1, 'completed request must not run again');
});

test('GitHub sidecar denies foreign repositories, raw commands, paths and stale requests before execution', async t => {
  const f = fixture(t); let calls = 0;
  for (const payload of [
    { operation: 'account', id: 'ff00599c-abcd-4b33-9111-00ee66aa44bb' },
    { operation: 'main', repo: 'other/private' },
    { operation: 'main', repo: 'example/one', argv: ['auth', 'token'] },
    { operation: 'source', repo: 'example/one', target: '../elsewhere' },
    { operation: 'shell', repo: 'example/one' },
    { operation: 'checks', repo: 'example/one', sha: '--help' }
  ]) assert.throws(() => enqueue(f.config, payload), /SIDECAR_REQUEST_REJECTED/);
  const expired = enqueue(f.config, { operation: 'account' }, { now: Date.now() - 180_000 });
  await processPending(f.config, { observedSid: f.config.userSid, execute: async () => { calls++; } });
  const result = readReply(f.config, expired);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'SIDECAR_REQUEST_EXPIRED');
  assert.equal(calls, 0);
});

test('GitHub sidecar rejects a service or foreign user identity without touching a pending request', async t => {
  const f = fixture(t), request = enqueue(f.config, { operation: 'account' }); let calls = 0;
  await assert.rejects(processPending(f.config, { observedSid: 'S-1-5-18', execute: async () => { calls++; } }),
    /SIDECAR_USER_MISMATCH/);
  assert.equal(calls, 0);
  assert.equal(readReply(f.config, request), null);
  assert.equal(existsSync(join(f.root, 'queue', request.id + '.json')), true);
});

test('GitHub sidecar records failure without credential text and rejects conflicting request IDs', async t => {
  const f = fixture(t), request = enqueue(f.config, { operation: 'account' });
  const syntheticCredential = 'ghp_' + 'x'.repeat(36);
  await processPending(f.config, { observedSid: f.config.userSid, execute: async () => {
    throw new Error('upstream error ' + syntheticCredential);
  } });
  const original = readFileSync(f.reply(request.id), 'utf8');
  assert.equal(JSON.parse(original).error.code, 'SIDECAR_OPERATION_FAILED');
  assert.equal(original.includes(syntheticCredential), false);
  const changed = { ...request, operation: 'main', repo: 'example/one' };
  writeFileSync(join(f.root, 'queue', request.id + '.json'), JSON.stringify(changed));
  let calls = 0;
  await processPending(f.config, { observedSid: f.config.userSid, execute: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(readFileSync(f.reply(request.id), 'utf8'), original);
  assert.equal(existsSync(join(f.root, 'queue', request.id + '.rejected')), true);
});

test('GitHub sidecar rejects a reparse-point state root instead of following it', t => {
  const f = fixture(t), alias = join(f.root, 'alias'), target = join(f.root, 'target');
  mkdirSync(target); symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateConfig({ ...f.config, root: alias }), /SIDECAR_PATH_REJECTED/);
});
