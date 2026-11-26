import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { noLinks, sha } from './core.mjs';

const origin = 'https://api.github.com';
const responseLimit = 115 * 1024;
const safeHeaders = ['x-github-request-id', 'x-accepted-github-permissions',
  'retry-after', 'link', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

export function gitCredentialEnvironment(environment) {
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(?:git_|gcm_|gh_|github_token$)/i.test(key)));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
}

function getCredential(config) {
  let helper;
  try {
    helper = noLinks(config.gitCredentialHelper);
    if (sha(readFileSync(helper)) !== config.gitCredentialHelperSha256) return null;
  } catch {
    return null;
  }

  // Git Bash interprets ! helpers. Restrict and quote the installed path.
  const helperCommand = helper.replaceAll('\\', '/');
  if (!/^[A-Za-z]:\/[A-Za-z0-9_./ -]+\.cmd$/i.test(helperCommand)) return null;
  const result = spawnSync(noLinks(config.gitCredentialGit),
    ['-c', 'credential.helper=', '-c', `credential.helper=!'${helperCommand}'`, 'credential', 'fill'],
    { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', maxBuffer: 16384,
      timeout: 8000, windowsHide: true, env: gitCredentialEnvironment(process.env) });
  if (result.status !== 0 || result.error) return null;
  const passwords = result.stdout.split(/\r?\n/).filter(line => line.startsWith('password='));
  const token = passwords.length === 1 ? passwords[0].slice(9) : '';
  return /^[A-Za-z0-9_]{16,512}$/.test(token) ? token : null;
}

async function send(input, token, fetchRequest) {
  const url = new URL('/' + input.endpoint, origin);
  if (url.origin !== origin || url.username || url.password) return { error: 'endpoint_rejected' };
  const response = await fetchRequest(url, {
    method: input.method,
    redirect: 'manual',
    signal: AbortSignal.timeout(29000),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'HASHI Sidecar',
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const headers = {};
  for (const name of safeHeaders) {
    const value = response.headers.get(name);
    if (value && !value.includes(token)) headers[name] = value;
  }
  if (response.status >= 300) {
    await response.body?.cancel();
    return { status: response.status, headers, body: '' };
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > responseLimit) return { error: 'response_limit' };
      chunks.push(chunk);
    }
  }
  const body = Buffer.concat(chunks).toString('utf8').replaceAll(token, '[redacted]');
  return { status: response.status, headers, body };
}

export async function requestWithCredential(input, {
  credential = getCredential, fetchRequest = fetch,
} = {}) {
  let account;
  let token;
  try {
    token = credential(input);
    if (!token) return { error: 'credential_unavailable' };
    account = await send({ method: 'GET', endpoint: 'user' }, token, fetchRequest);
    if (account.status !== 200) return { ...account, preflight: true };
    const login = JSON.parse(account.body)?.login;
    if (typeof login !== 'string' || login.toLowerCase() !== input.expectedLogin.toLowerCase()) {
      return { error: 'account_mismatch' };
    }
  } catch {
    return { error: 'preflight_failure' };
  }
  return send(input, token, fetchRequest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(JSON.stringify(await requestWithCredential(input)));
  } catch {
    process.stdout.write(JSON.stringify({ error: 'transport_failure' }));
  }
}
