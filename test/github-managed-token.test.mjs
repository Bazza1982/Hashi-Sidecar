import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gitCredentialEnvironment, requestWithCredential } from '../scripts/admin-sidecar/github-token.mjs';

const fixtureCredential = 'synthetic_credential_for_tests';
const input = { expectedLogin: 'example-owner', method: 'POST', endpoint: 'repos/example/repo/actions/workflows/test.yml/dispatches', body: { ref: 'review-branch' } };
const json = (data, options) => Response.json(data, options);
const requestData = async (input, options) => JSON.parse(await requestWithCredential(input, options));

test('managed GitHub uses the same confined credential for preflight and the exact Actions request', async () => {
  const calls = [];
  let credentialReads = 0;
  const result = await requestData(input, {
    credential: () => { credentialReads++; return fixtureCredential; },
    fetchRequest: async (url, options) => {
      calls.push([url.href, options]);
      if (calls.length === 1) return json({ login: 'Example-Owner' });
      return json({ message: fixtureCredential }, { status: 201, headers: {
        'x-github-request-id': 'request-id', 'link': '<https://api.github.com/page>; rel="next"',
        'x-unrecognized-header': fixtureCredential,
      } });
    },
  });
  assert.equal(credentialReads, 1);
  assert.deepEqual(calls.map(([url, options]) => [url, options.method, options.redirect]), [
    ['https://api.github.com/user', 'GET', 'manual'],
    ['https://api.github.com/' + input.endpoint, 'POST', 'manual'],
  ]);
  assert.ok(calls.every(([, options]) => options.headers.Authorization === 'Bearer ' + fixtureCredential));
  assert.equal(calls[1][1].body, JSON.stringify(input.body));
  assert.equal(result.status, 201);
  assert.equal(result.headers['x-github-request-id'], 'request-id');
  assert.ok(result.headers.link);
  assert.equal(result.data.message, '[redacted]');
  assert.ok(!JSON.stringify(result).includes(fixtureCredential));
});

test('missing, rejected or mismatched authentication never reaches the operation', async () => {
  const noCredential = () => assert.fail('No request should be sent');
  assert.deepEqual(await requestData(input, { credential: () => null, fetchRequest: noCredential }),
    { error: 'credential_unavailable' });
  for (const response of [json({ login: 'other' }), json({ message: 'rejected' }, { status: 401 })]) {
    let calls = 0;
    const result = await requestData(input, {
      credential: () => fixtureCredential,
      fetchRequest: async () => {
        assert.equal(++calls, 1);
        return response;
      },
    });
    if (response.status === 401) assert.deepEqual(result, { status: 401, data: '', headers: {}, preflight: true });
    else assert.deepEqual(result, { error: 'account_mismatch' });
  }
});

test('a download redirect is not followed and its signed URL stays private', async () => {
  let calls = 0;
  const result = await requestData({ ...input, method: 'GET', body: undefined }, {
    credential: () => fixtureCredential,
    fetchRequest: async () => ++calls === 1
      ? json({ login: 'example-owner' })
      : new Response(null, { status: 302, headers: { Location: 'https://example.invalid/signed' } }),
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { status: 302, data: '', headers: {} });
});

test('managed GitHub JSON is bounded by the serialized Native output, including envelope bytes', async () => {
  const nativeLimit = 131072;
  const data = { items: Array.from({ length: 4170 }, () => ({ id: 1, name: 'abc' })), padding: '' };
  data.padding = 'a'.repeat(115817 - Buffer.byteLength(JSON.stringify(data)));
  const raw = JSON.stringify(data);
  assert.equal(Buffer.byteLength(raw), 115817);
  assert.ok(Buffer.byteLength(JSON.stringify({ status: 200, headers: {}, body: raw })) > nativeLimit);

  const request = body => requestWithCredential({ ...input, method: 'GET', body: undefined }, {
    credential: () => fixtureCredential,
    fetchRequest: async url => url.pathname === '/user'
      ? json({ login: 'example-owner' })
      : new Response(body, { headers: { 'Content-Type': 'application/json' } }),
  });

  const output = await request(raw);
  assert.ok(Buffer.byteLength(output) <= nativeLimit);
  assert.deepEqual(JSON.parse(output), { status: 200, headers: {}, data });
  const exact = nativeLimit - Buffer.byteLength(output);
  data.padding += 'x'.repeat(exact);
  const boundary = await request(' '.repeat(20000) + JSON.stringify(data));
  assert.equal(Buffer.byteLength(boundary), nativeLimit);
  assert.deepEqual(JSON.parse(boundary).data, data);
  data.padding = data.padding.slice(1) + 'é';
  assert.deepEqual(JSON.parse(await request(JSON.stringify(data))), { error: 'response_limit' });
});

test('Git starts without inherited helpers, traces or CLI credentials', () => {
  assert.deepEqual(gitCredentialEnvironment({
    Path: 'preserved', git_askpass: 'blocked', GIT_CONFIG_COUNT: '4', GIT_TRACE: '1',
    GIT_CURL_VERBOSE: '1', Gh_Token: 'blocked', GITHUB_TOKEN: 'blocked', GCM_TRACE: '1',
  }), { Path: 'preserved', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
});
