import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, mkdirSync, openSync, readSync, closeSync, fstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const shaPattern = /^[0-9a-f]{40}$/;
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const writeOperations = new Set(['push', 'write', 'pr-create', 'pr-merge', 'pr-update-base', 'pr-edit', 'pr-comment']);
const pullReads = new Set(['pr-view', 'pr-files', 'pr-comments']);
const pullWrites = new Set(['pr-edit', 'pr-comment']);
const operations = ['account', 'main', 'checks', 'check-log', 'source', 'branch', 'pr-list', 'merge-info', ...pullReads, ...writeOperations];
export function supportedOperations() { return [...operations,'result']; }
const apiResources = new Set(['account','repository','branch','branch_protection','branch_rules',
  'pull_request','pull_request_merge','pull_request_files','pull_request_comments','check_runs','commit_status','workflow_runs','workflow_jobs','other']);
const upstreamReasons = [
  [/merge commits? (?:are )?not allowed|merge method.*not allowed/i,'MERGE_METHOD_NOT_ALLOWED'],
  [/linear history/i,'LINEAR_HISTORY_REQUIRED'],
  [/base branch was modified|base branch.*changed/i,'BASE_CHANGED'],
  [/head.*(?:changed|modified)|head sha.*match/i,'HEAD_CHANGED'],
  [/up.to.date|out.of.date|behind.*base/i,'BRANCH_NOT_UP_TO_DATE'],
  [/required status check|checks?.*(?:expected|missing|not passed)/i,'REQUIRED_STATUS_CHECK'],
  [/approv|review.*required|required.*review/i,'REVIEW_REQUIRED'],
  [/protected branch|repository rules|rule violations/i,'BRANCH_PROTECTION_REJECTED'],
  [/not mergeable|cannot be merged|merge conflict/i,'NOT_MERGEABLE'],
  [/rate limit/i,'RATE_LIMITED'],
  [/bad credentials|requires authentication/i,'AUTHENTICATION_REQUIRED'],
  [/resource not accessible|permission|not permitted/i,'PERMISSION_DENIED'],
  [/not found/i,'NOT_FOUND'],
  [/validation failed/i,'VALIDATION_REJECTED'],
];
const safeUpstreamReasons = new Set([...upstreamReasons.map(([,reason])=>reason),'API_REJECTED','PROCESS_FAILED']);
function validBranch(value) {
  return typeof value === 'string' && value.length <= 200 && value.split('/').every(
    part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && !part.includes('..') &&
      !part.endsWith('.') && !part.endsWith('.lock'));
}
function editableBranch(value) { return validBranch(value) && !['main', 'master', 'HEAD'].includes(value); }
function validFile(value) {
  return typeof value === 'string' && value.length <= 500 && !value.includes('\\') &&
    value.split('/').every(part => part && !['.', '..', '.git'].includes(part.toLowerCase()) &&
      !/[\x00-\x1f\x7f:]/.test(part));
}
function fail(code, httpStatus) { const e = new Error(code); e.code = code; if (httpStatus) e.httpStatus = httpStatus; throw e; }
function noLinks(path) {
  let current = resolve(path);
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail('SIDECAR_PATH_REJECTED');
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return resolve(path);
}
function samePath(a,b) {
  const names=[a,b].map(path=>realpathSync.native(noLinks(path)));
  return process.platform==='win32'?names[0].toLowerCase()===names[1].toLowerCase():names[0]===names[1];
}
function inside(root, ...parts) {
  const path = resolve(root, ...parts), rel = relative(resolve(root), path);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail('SIDECAR_PATH_REJECTED');
  return noLinks(path);
}
function json(path, max = 2 * 1024 * 1024) {
  noLinks(path);
  const bytes = readFileSync(path); if (bytes.length > max) fail('SIDECAR_SIZE_REJECTED');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
function atomic(path, value) {
  noLinks(path);
  const tmp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  renameSync(tmp, path);
}
export function repositoryAllowed(c, repo, { write = false } = {}) {
  if (typeof repo !== 'string' || !repoPattern.test(repo)) return false;
  const scope = write ? c.writeRepositoryScope : c.repositoryScope;
  if (scope === 'account') {
    return repo.split('/')[0].toLowerCase() === c.expectedGitHubLogin.toLowerCase();
  }
  return (write ? c.writeRepositories || [] : c.repositories || [])
    .some(allowed => allowed.toLowerCase() === repo.toLowerCase());
}
export function validateConfig(c) {
  if (!c || c.schemaVersion !== 1 || !uuid.test(c.installationId) || !isAbsolute(c.root || '') ||
      !/^S-1-5-21-(\d+-){2,}\d+$/.test(c.userSid || '') ||
      !/^HashiHubV2-GitHubRead-[a-zA-Z0-9-]+$/.test(c.taskName || '') || c.taskPath !== '\\' ||
      (c.repositoryScope !== undefined && !['list', 'account'].includes(c.repositoryScope)) ||
      (c.writeRepositoryScope !== undefined && !['list', 'account'].includes(c.writeRepositoryScope)) ||
      (c.writeRepositoryScope === 'account' && c.repositoryScope !== 'account') ||
      !Array.isArray(c.repositories) || (c.repositoryScope !== 'account' && !c.repositories.length) || c.repositories.length > 16 ||
      !/^[A-Za-z0-9-]{1,39}$/.test(c.expectedGitHubLogin || '') ||
      c.repositories.some(r => typeof r !== 'string' || !repoPattern.test(r)) ||
      new Set(c.repositories.map(r => r.toLowerCase())).size !== c.repositories.length ||
      !['ghPath', 'gitPath', 'workerPath', 'userProfile'].every(k => typeof c[k] === 'string' && isAbsolute(c[k])) ||
      !/^[0-9a-f]{64}$/.test(c.workerSHA256 || '')) fail('SIDECAR_CONFIG_REJECTED');
  noLinks(c.root);
  if (c.writeRepositories !== undefined && (!Array.isArray(c.writeRepositories) ||
      c.writeRepositories.some(r => !repositoryAllowed(c, r)) ||
      new Set(c.writeRepositories.map(r => r.toLowerCase())).size !== c.writeRepositories.length)) fail('SIDECAR_CONFIG_REJECTED');
  for (const folder of ['queue', 'responses', 'sources', 'hooks', 'uploads', 'requests', 'claims', 'work']) inside(c.root, folder);
  return c;
}
export function validateRequest(c, r, { now = Date.now(), checkTime = true } = {}) {
  const fields = {
    account: [], main: ['repo'], checks: ['repo','sha'], 'check-log':['repo','sha','job'], source: ['repo','sha'],
    branch: ['repo','branch'], 'pr-list': ['repo','branch','baseBranch'],
    'merge-info': ['repo','pr','sha','baseBranch'],
    push: ['repo','branch','sha','base','expectedHead','artifact'],
    write: ['repo','branch','base','message','files'],
    'pr-create': ['repo','branch','sha','baseBranch','title','body'],
    'pr-merge': ['repo','pr','sha','baseBranch'],
    'pr-update-base': ['repo','pr','sha','currentBaseBranch','baseBranch'],
    'pr-view': ['repo','pr','sha'],
    'pr-files': ['repo','pr','sha','limit'],
    'pr-comments': ['repo','pr','sha','limit'],
    'pr-edit': ['repo','pr','sha','revision','title','body'],
    'pr-comment': ['repo','pr','sha','body'],
  };
  const common = ['schemaVersion','installationId','id','operation','issuedAt','expiresAt'];
  if (!r || !operations.includes(r.operation) || Object.keys(r).some(k => ![...common,...fields[r.operation]].includes(k)) ||
      r.schemaVersion !== 1 || r.installationId !== c.installationId || !uuid.test(r.id || '') ||
      !Number.isSafeInteger(r.issuedAt) || !Number.isSafeInteger(r.expiresAt) ||
      r.expiresAt <= r.issuedAt || r.expiresAt - r.issuedAt > 120_000) fail('SIDECAR_REQUEST_REJECTED');
  if (r.operation !== 'account' && !repositoryAllowed(c, r.repo)) fail('SIDECAR_REQUEST_REJECTED');
  if (writeOperations.has(r.operation) && !repositoryAllowed(c, r.repo, { write: true })) {
    fail('SIDECAR_WRITE_SCOPE_REJECTED');
  }
  if (r.sha !== undefined && !shaPattern.test(r.sha)) fail('SIDECAR_REQUEST_REJECTED');
  if (r.operation==='check-log' && (!shaPattern.test(r.sha || '') || !Number.isSafeInteger(r.job) || r.job<1)) fail('SIDECAR_REQUEST_REJECTED');
  if (fields[r.operation].includes('branch') && !validBranch(r.branch)) fail('SIDECAR_REQUEST_REJECTED');
  if (r.baseBranch !== undefined && !validBranch(r.baseBranch)) fail('SIDECAR_REQUEST_REJECTED');
  if (r.currentBaseBranch !== undefined && !validBranch(r.currentBaseBranch)) fail('SIDECAR_REQUEST_REJECTED');
  if (['push','write','pr-create'].includes(r.operation) &&
      !editableBranch(r.branch)) fail('SIDECAR_PROTECTED_BRANCH');
  if ((pullReads.has(r.operation) || pullWrites.has(r.operation)) &&
      (!Number.isSafeInteger(r.pr) || r.pr < 1 || r.pr > 2_147_483_647 ||
       (r.limit !== undefined && (!Number.isSafeInteger(r.limit) || r.limit < 1 || r.limit > 100)))) fail('SIDECAR_REQUEST_REJECTED');
  if (pullWrites.has(r.operation) && !shaPattern.test(r.sha || '')) fail('SIDECAR_REQUEST_REJECTED');
  if (r.operation === 'pr-edit' && (!/^[a-f0-9]{64}$/.test(r.revision || '') ||
      (r.title === undefined && r.body === undefined) ||
      (r.title !== undefined && (typeof r.title !== 'string' || !r.title.trim() || r.title.length > 256 || /[\x00\r\n]/.test(r.title))) ||
      (r.body !== undefined && (typeof r.body !== 'string' || Buffer.byteLength(r.body) > 65536 || r.body.includes('\0'))))) fail('SIDECAR_REQUEST_REJECTED');
  if (r.operation === 'pr-comment' && (typeof r.body !== 'string' || !r.body.trim() ||
      Buffer.byteLength(r.body) > 65536 || r.body.includes('\0'))) fail('SIDECAR_REQUEST_REJECTED');
  if (r.operation === 'push') {
    const a = r.artifact;
    if (!shaPattern.test(r.sha || '') || !shaPattern.test(r.base || '') ||
        (r.expectedHead !== undefined && !shaPattern.test(r.expectedHead)) || !a ||
        Object.keys(a).some(k => !['id','sha256','size'].includes(k)) || a.id !== r.id ||
        !/^[0-9a-f]{64}$/.test(a.sha256 || '') || !Number.isSafeInteger(a.size) ||
        a.size < 1 || a.size > 64 * 1024 * 1024) fail('SIDECAR_REQUEST_REJECTED');
  }
  if (r.operation === 'write') {
    if (!shaPattern.test(r.base || '') || typeof r.message !== 'string' || !r.message.trim() ||
        r.message.length > 4000 || !Array.isArray(r.files) || !r.files.length || r.files.length > 100 ||
        new Set(r.files.map(f => f?.path)).size !== r.files.length || r.files.some(f =>
          !f || Object.keys(f).some(k => !['path','content','delete'].includes(k)) || !validFile(f.path) ||
          (f.delete === true ? f.content !== undefined : f.delete !== undefined || typeof f.content !== 'string' ||
            Buffer.from(f.content,'base64').toString('base64') !== f.content)) ||
        Buffer.byteLength(JSON.stringify(r.files)) > 2 * 1024 * 1024) fail('SIDECAR_REQUEST_REJECTED');
  }
  if (r.operation === 'pr-create' && (!shaPattern.test(r.sha || '') || !validBranch(r.baseBranch) ||
      r.branch === r.baseBranch || typeof r.title !== 'string' || !r.title.trim() || r.title.length > 256 ||
      typeof r.body !== 'string' || r.body.length > 65536 || /[\x00]/.test(r.title + r.body))) fail('SIDECAR_REQUEST_REJECTED');
  if (['pr-merge','merge-info'].includes(r.operation) && (!Number.isSafeInteger(r.pr) || r.pr < 1 || r.pr > 2_147_483_647 ||
      !shaPattern.test(r.sha || '') || !validBranch(r.baseBranch))) fail('SIDECAR_REQUEST_REJECTED');
  if (r.operation === 'pr-update-base' && (!Number.isSafeInteger(r.pr) || r.pr < 1 || r.pr > 2_147_483_647 ||
      !shaPattern.test(r.sha || '') || !validBranch(r.currentBaseBranch) || !validBranch(r.baseBranch) ||
      r.currentBaseBranch === r.baseBranch)) fail('SIDECAR_REQUEST_REJECTED');
  if (checkTime && (r.expiresAt < now || r.issuedAt > now + 30_000)) fail('SIDECAR_REQUEST_EXPIRED');
  return r;
}
export function enqueue(c, payload, { now = Date.now(), id = randomUUID() } = {}) {
  validateConfig(c);
  if (!payload || Object.keys(payload).some(k => ['schemaVersion','installationId','id','issuedAt','expiresAt'].includes(k)) ||
      !uuid.test(id)) fail('SIDECAR_REQUEST_REJECTED');
  const request = { schemaVersion: 1, installationId: c.installationId, id,
    issuedAt: now, expiresAt: now + 120_000, ...payload };
  validateRequest(c, request, { now });
  if (writeOperations.has(payload.operation)) {
    const path = inside(c.root, 'requests', id + '.json');
    if (existsSync(path)) {
      const previous = json(path, 3 * 1024 * 1024);
      const input = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['issuedAt','expiresAt'].includes(key)));
      if (digest(input(previous)) !== digest(input(request))) fail('SIDECAR_REQUEST_ID_REUSED');
      return previous;
    }
    writeFileSync(path, JSON.stringify(request) + '\n', { flag: 'wx' });
  }
  atomic(inside(c.root, 'queue', request.id + '.json'), request);
  return request;
}
export function requestResult(c, id) {
  validateConfig(c);
  if (!uuid.test(id || '')) fail('SIDECAR_ARGUMENT_REJECTED');
  const path = inside(c.root, 'requests', id + '.json');
  if (!existsSync(path)) fail('SIDECAR_REQUEST_NOT_FOUND');
  const request = json(path, 3 * 1024 * 1024);
  return readReply(c, request) || { schemaVersion: 1, installationId: c.installationId, requestId: id,
    ok: false, error: { code: existsSync(inside(c.root,'claims',id+'.json')) ? 'SIDECAR_WRITE_OUTCOME_UNCERTAIN' : 'SIDECAR_REQUEST_PENDING' } };
}
export function readReply(c, request) {
  const path = inside(c.root, 'responses', request.id + '.json');
  if (!existsSync(path)) return null;
  const reply = json(path);
  if (reply.schemaVersion !== 1 || reply.installationId !== c.installationId ||
      reply.requestId !== request.id || reply.requestDigest !== digest(request) ||
      reply.observedUserSid !== c.userSid) fail('SIDECAR_RESPONSE_REJECTED');
  return reply;
}
function projectedError(error) {
  const code = /^SIDECAR_[A-Z_]+$/.test(error?.code || '') ? error.code : 'SIDECAR_OPERATION_FAILED';
  return { code,
    ...(Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus < 600 ? {httpStatus:error.httpStatus} : {}),
    ...(safeUpstreamReasons.has(error?.upstreamReason) ? {upstreamReason:error.upstreamReason} : {}),
    ...(['GET','POST','PUT','PATCH','DELETE'].includes(error?.apiMethod) ? {apiMethod:error.apiMethod} : {}),
    ...(apiResources.has(error?.apiResource) ? {apiResource:error.apiResource} : {}),
    ...(Number.isInteger(error?.exitCode) && error.exitCode >= 0 && error.exitCode <= 255 ? {exitCode:error.exitCode} : {})
  };
}
export async function processPending(c, { observedSid, execute }) {
  validateConfig(c);
  if (observedSid !== c.userSid) fail('SIDECAR_USER_MISMATCH');
  const names = readdirSync(inside(c.root, 'queue')).filter(n => n.endsWith('.json')).sort().slice(0, 32);
  let processed = 0;
  for (const name of names) {
    const id = name.slice(0, -5);
    if (!uuid.test(id)) continue;
    const pending = inside(c.root, 'queue', name), running = inside(c.root, 'queue', id + '.running');
    try { renameSync(pending, running); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    let request, fingerprint, reply;
    const responsePath = inside(c.root, 'responses', name), startedAt = new Date().toISOString();
    try {
      request = json(running, 3 * 1024 * 1024); fingerprint = digest(request);
      if (existsSync(responsePath)) {
        const old = json(responsePath);
        if (old.requestDigest !== fingerprint) fail('SIDECAR_REQUEST_ID_REUSED');
        unlinkSync(running); continue;
      }
      validateRequest(c, request);
      if (request.id !== id) fail('SIDECAR_REQUEST_REJECTED');
      if (writeOperations.has(request.operation)) {
        const claim = inside(c.root,'claims',id+'.json');
        if (existsSync(claim)) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
        writeFileSync(claim, JSON.stringify({requestDigest:fingerprint,startedAt}) + '\n', {flag:'wx'});
      }
      const data = await execute(request);
      reply = { ok: true, data };
    } catch (e) {
      if (existsSync(responsePath)) {
        renameSync(running, inside(c.root, 'queue', id + '.rejected')); continue;
      }
      reply = { ok: false, error: projectedError(e) };
    }
    atomic(responsePath, { schemaVersion: 1, installationId: c.installationId, requestId: id,
      requestDigest: fingerprint || '', observedUserSid: observedSid, startedAt, finishedAt: new Date().toISOString(), ...reply });
    unlinkSync(running); processed++;
  }
  return processed;
}
function userEnvironment(c) {
  const env = { ...process.env, USERPROFILE: c.userProfile, APPDATA: join(c.userProfile, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(c.userProfile, 'AppData', 'Local'), GH_CONFIG_DIR: join(c.userProfile, 'AppData', 'Roaming', 'GitHub CLI'),
    GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[key];
  return env;
}
function apiResource(endpoint) {
  if (endpoint === 'user') return 'account';
  if (/\/pulls\/\d+\/merge$/.test(endpoint)) return 'pull_request_merge';
  if (/\/pulls\/\d+\/files\?/.test(endpoint)) return 'pull_request_files';
  if (/\/issues\/(?:\d+\/comments|comments\/\d+)(?:\?|$)/.test(endpoint)) return 'pull_request_comments';
  if (/\/pulls\/\d+$/.test(endpoint)) return 'pull_request';
  if (/\/protection(?:\?|$)/.test(endpoint)) return 'branch_protection';
  if (/\/rules\/branches\//.test(endpoint)) return 'branch_rules';
  if (/\/branches\//.test(endpoint)) return 'branch';
  if (/\/check-runs\?/.test(endpoint)) return 'check_runs';
  if (/\/status\?/.test(endpoint)) return 'commit_status';
  if (/\/actions\/runs\?/.test(endpoint)) return 'workflow_runs';
  if (/\/actions\/jobs\/\d+$/.test(endpoint)) return 'workflow_jobs';
  if (/^repos\/[^/]+\/[^/]+$/.test(endpoint)) return 'repository';
  return 'other';
}
function apiFailure(result, api) {
  let body;
  try { body=JSON.parse(String(result.stdout || '').slice(0,16384)); } catch { /* never persist raw output */ }
  const observed=Number(String(result.stderr || '').match(/\bHTTP\s+([45]\d\d)\b/i)?.[1] || body?.status);
  const status=Number.isInteger(observed) && observed >= 400 && observed < 600 ? observed : undefined;
  const details=Array.isArray(body?.errors) ? body.errors.slice(0,10)
    .map(value=>typeof value === 'string' ? value : value?.message).filter(value=>typeof value === 'string') : [];
  const text=[body?.message,...details,String(result.stderr || '')]
    .filter(value=>typeof value === 'string').join('\n').slice(0,32768);
  const error=Object.assign(new Error('SIDECAR_UPSTREAM_FAILED'),{
    code:'SIDECAR_UPSTREAM_FAILED',
    upstreamReason:upstreamReasons.find(([pattern])=>pattern.test(text))?.[1] || (status ? 'API_REJECTED' : 'PROCESS_FAILED'),
    apiMethod:api.method,apiResource:api.resource
  });
  if(status) error.httpStatus=status;
  if(Number.isInteger(result.status)) error.exitCode=result.status;
  return error;
}
function native(exe, args, { env, cwd, timeout = 40_000, allowNoMatch = false, input, api } = {}) {
  const result = spawnSync(exe, args, { env, cwd, timeout, input, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  if (result.error?.code === 'ETIMEDOUT') fail('SIDECAR_COMMAND_TIMEOUT');
  if (allowNoMatch && result.status === 1 && !result.stdout) return '';
  if (result.status !== 0 || result.error) {
    if(api) throw apiFailure(result,api);
    const observed=Number(String(result.stderr || '').match(/\bHTTP\s+([45]\d\d)\b/i)?.[1]);
    fail('SIDECAR_UPSTREAM_FAILED',observed || undefined);
  }
  return (result.stdout || '').trimEnd();
}
function github(c, endpoint, projection) {
  const text = native(c.ghPath, ['api', endpoint, '--jq', projection],
    { env: userEnvironment(c), api:{method:'GET',resource:apiResource(endpoint)} });
  try { return JSON.parse(text); } catch { fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED'); }
}
function mainHead(c, repo) {
  const repository = github(c, 'repos/' + repo, '{name:.full_name,private:.private,defaultBranch:.default_branch,url:.html_url}');
  const main = github(c, 'repos/' + repo + '/branches/main', '{sha:.commit.sha,committedAt:.commit.commit.committer.date,url:.commit.html_url}');
  if (!shaPattern.test(main.sha || '') || repository.name?.toLowerCase() !== repo.toLowerCase()) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
  return { repository, ...main };
}
function shellQuoted(value) { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
function gitCall(c, args, { cwd, timeout, allowNoMatch, localFile = false } = {}) {
  const helper = '!' + shellQuoted(c.ghPath.replace(/\\/g, '/')) + ' auth git-credential';
  const options = ['-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=' + helper,
    '-c', 'core.hooksPath=' + inside(c.root, 'hooks'), '-c', 'core.fsmonitor=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always'];
  if (localFile) options.push('-c', 'protocol.file.allow=always');
  return native(c.gitPath, [...options, ...args], { env: userEnvironment(c), cwd, timeout: timeout || 60_000, allowNoMatch });
}
function verifyRepository(c, folder, sha) {
  inside(c.root, relative(c.root, folder));
  if (!existsSync(join(folder, '.git'))) fail('SIDECAR_SOURCE_INCOMPLETE');
  const top = gitCall(c, ['rev-parse', '--show-toplevel'], { cwd: folder });
  if (!samePath(top,folder)) fail('SIDECAR_SOURCE_INCOMPLETE');
  const head = gitCall(c, ['rev-parse', 'HEAD'], { cwd: folder });
  if (head !== sha || gitCall(c, ['status', '--porcelain', '--untracked-files=no'], { cwd: folder })) fail('SIDECAR_SOURCE_CONFLICT');
}
function source(c, request) {
  const pin = request.sha || mainHead(c, request.repo).sha;
  const destination = inside(c.root, 'sources', request.repo.replace('/', '--') + '-' + pin.slice(0, 12));
  if (!existsSync(destination)) {
    gitCall(c, ['clone', '--no-checkout', '--depth', '1', '--branch', 'main', '--',
      'https://github.com/' + request.repo + '.git', destination], { timeout: 100_000 });
    gitCall(c, ['fetch', '--depth', '1', 'origin', pin], { cwd: destination });
    gitCall(c, ['checkout', '--detach', pin], { cwd: destination });
  }
  verifyRepository(c, destination, pin);
  const modules = [];
  function submodules(folder, depth = 0) {
    if (depth > 4 || modules.length > 16) fail('SIDECAR_SOURCE_DEPENDENCY_LIMIT');
    if (!existsSync(join(folder, '.gitmodules'))) return;
    const records = gitCall(c, ['config', '--null', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$'],
      { cwd: folder, allowNoMatch: true }).split('\0').filter(Boolean);
    const groups = new Map();
    for (const record of records) {
      const split = record.indexOf('\n'), match = record.slice(0, split).match(/^submodule\.(.+)\.(path|url)$/);
      if (split < 0 || !match) fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED');
      const entry = groups.get(match[1]) || {};
      if (entry[match[2]] !== undefined) fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED');
      entry[match[2]] = record.slice(split + 1); groups.set(match[1], entry);
    }
    for (const [name, entry] of groups) {
      if (!entry.path || /[\r\n\0]/.test(entry.path) || !entry.url) fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED');
      let url; try { url = new URL(entry.url); } catch { fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED'); }
      const repo = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash ||
          !repositoryAllowed(c, repo)) fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED');
      const target = inside(folder, entry.path);
      if (target === folder) fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED');
      const tree = gitCall(c, ['ls-tree', 'HEAD', '--', entry.path], { cwd: folder });
      const expected = tree.match(/^160000 commit ([0-9a-f]{40})\t/)?.[1];
      if (!expected) fail('SIDECAR_SOURCE_DEPENDENCY_REJECTED');
      gitCall(c, ['-c', 'submodule.' + name + '.url=' + entry.url, 'submodule', 'update', '--init', '--depth', '1', '--', entry.path],
        { cwd: folder, timeout: 100_000 });
      verifyRepository(c, target, expected);
      modules.push({ path: relative(destination, target), repository: repo, sha: expected });
      submodules(target, depth + 1);
    }
  }
  submodules(destination);
  verifyRepository(c, destination, pin);
  return { repository: request.repo, sha: pin, sourceRoot: destination, clean: true, submodules: modules };
}
function githubMutation(c, endpoint, body, projection, method = 'POST') {
  const text = native(c.ghPath, ['api', '--method', method, endpoint, '--input', '-', '--jq', projection],
    { env: userEnvironment(c), input: JSON.stringify(body), api:{method,resource:apiResource(endpoint)} });
  try { return JSON.parse(text); } catch { fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED'); }
}
function repository(c, repo) {
  const data = github(c, 'repos/' + repo, '{name:.full_name,private:.private,defaultBranch:.default_branch}');
  if (data.name?.toLowerCase() !== repo.toLowerCase() || !validBranch(data.defaultBranch)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
  return data;
}
function branchHead(c, repo, branch) {
  try {
    const ref = github(c, 'repos/' + repo + '/git/ref/heads/' + encodeURIComponent(branch), '{sha:.object.sha}');
    if (!shaPattern.test(ref.sha || '')) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
    return ref.sha;
  } catch (error) { if (error.httpStatus === 404) return null; throw error; }
}
function pullRequests(c, repo, branch, baseBranch) {
  const query = 'repos/' + repo + '/pulls?state=all&per_page=100&head=' + encodeURIComponent(repo.split('/')[0] + ':' + branch) +
    (baseBranch ? '&base=' + encodeURIComponent(baseBranch) : '');
  const result = github(c, query, '[.[]|{number,state,title,url:.html_url,head:.head.ref,sha:.head.sha,base:.base.ref,repository:.head.repo.full_name}]');
  if (!Array.isArray(result) || result.length >= 100 || result.some(p => p.head !== branch ||
      p.repository?.toLowerCase() !== repo.toLowerCase() || !shaPattern.test(p.sha || ''))) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
  return result;
}
export function publishBundle(c, r, git = (args, options) => gitCall(c,args,options), url = 'https://github.com/' + r.repo + '.git') {
  const input = inside(c.root,'uploads',r.id+'.bundle');
  const bytes = readFileSync(input);
  if (bytes.length !== r.artifact.size || createHash('sha256').update(bytes).digest('hex') !== r.artifact.sha256) fail('SIDECAR_ARTIFACT_CHANGED');
  const folder = inside(c.root,'work',r.id);
  if (existsSync(folder)) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  mkdirSync(folder);
  const bundle = inside(folder,'source.bundle');
  writeFileSync(bundle,bytes,{flag:'wx'});
  const bare = inside(folder,'repository.git');
  git(['init','--bare',bare]);
  git(['fetch','--no-tags',url,r.base],{cwd:bare,timeout:100_000});
  git(['bundle','verify',bundle],{cwd:bare});
  if (git(['bundle','list-heads',bundle],{cwd:bare}) !== r.sha + ' HEAD') fail('SIDECAR_ARTIFACT_REJECTED');
  git(['fetch','--no-tags',bundle,'HEAD:refs/heads/publish'],{cwd:bare,localFile:true});
  if (git(['rev-parse','refs/heads/publish'],{cwd:bare}) !== r.sha ||
      git(['merge-base',r.base,r.sha],{cwd:bare}) !== r.base) fail('SIDECAR_ARTIFACT_REJECTED');
  git(['push','--porcelain',url,'refs/heads/publish:refs/heads/' + r.branch],{cwd:bare,timeout:100_000});
}
export function preparePush(c, { repo, checkout, branch, sha, base, expectedHead }, id = randomUUID()) {
  validateConfig(c);
  const probe = { operation:'push',repo,branch,sha,base,...(expectedHead ? {expectedHead}:{}),
    artifact:{id,sha256:'0'.repeat(64),size:1} };
  const now = Date.now();
  validateRequest(c,{schemaVersion:1,installationId:c.installationId,id,issuedAt:now,expiresAt:now+120_000,...probe});
  if (typeof checkout !== 'string' || !isAbsolute(checkout)) fail('SIDECAR_ARGUMENT_REJECTED');
  const folder = noLinks(checkout), out = inside(c.root,'uploads',id+'.bundle');
  if (!samePath(gitCall(c,['rev-parse','--show-toplevel'],{cwd:folder}),folder) ||
      gitCall(c,['rev-parse','HEAD'],{cwd:folder}) !== sha ||
      gitCall(c,['status','--porcelain','--untracked-files=no'],{cwd:folder})) fail('SIDECAR_SOURCE_CONFLICT');
  if (gitCall(c,['merge-base',base,sha],{cwd:folder}) !== base || base === sha) fail('SIDECAR_ARTIFACT_REJECTED');
  if (existsSync(out)) fail('SIDECAR_REQUEST_ID_REUSED');
  gitCall(c,['bundle','create',out,'HEAD','^'+base],{cwd:folder});
  const bytes = readFileSync(out);
  if (bytes.length > 64 * 1024 * 1024 || gitCall(c,['rev-parse','HEAD'],{cwd:folder}) !== sha ||
      gitCall(c,['status','--porcelain','--untracked-files=no'],{cwd:folder})) fail('SIDECAR_SOURCE_CONFLICT');
  return {...probe,artifact:{id,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length}};
}
function writePort(c) {
  return {
    repository: repo => repository(c,repo),
    head: (repo,branch) => branchHead(c,repo,branch),
    pulls: (repo,branch,base) => pullRequests(c,repo,branch,base),
    push: request => publishBundle(c,request),
    pull: (repo,number) => github(c,'repos/'+repo+'/pulls/'+number,
      '{number,state,merged,draft,mergeable,sha:.head.sha,head:.head.ref,base:.base.ref,repository:.base.repo.full_name,mergeCommit:.merge_commit_sha,url:.html_url}'),
    checks: (repo,sha) => executeRead(c,{operation:'checks',repo,sha}),
    mergePull: request => githubMutation(c,'repos/'+request.repo+'/pulls/'+request.pr+'/merge',
      {sha:request.sha,merge_method:'merge'},'{merged,sha}','PUT'),
    updatePull: request => githubMutation(c,'repos/'+request.repo+'/pulls/'+request.pr,
      {base:request.baseBranch},
      '{number,state,merged,draft,mergeable,sha:.head.sha,head:.head.ref,base:.base.ref,repository:.base.repo.full_name,mergeCommit:.merge_commit_sha,url:.html_url}',
      'PATCH'),
    createPull: request => githubMutation(c,'repos/'+request.repo+'/pulls',
      {head:request.branch,base:request.baseBranch,title:request.title,body:request.body},
      '{number,state,title,url:.html_url,head:.head.ref,sha:.head.sha,base:.base.ref,repository:.head.repo.full_name}'),
    write: request => {
      const split = request.message.indexOf('\n');
      const message = split < 0 ? {headline:request.message} : {headline:request.message.slice(0,split),body:request.message.slice(split+1)};
      const query = 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid,url}}}';
      const value = githubMutation(c,'graphql',{query,variables:{input:{
        branch:{repositoryNameWithOwner:request.repo,branchName:request.branch},expectedHeadOid:request.base,message,
        fileChanges:{additions:request.files.filter(f=>!f.delete).map(f=>({path:f.path,contents:f.content})),
          deletions:request.files.filter(f=>f.delete).map(f=>({path:f.path}))}
      }}}, '{errors,data}');
      if (value.errors?.length) fail('SIDECAR_WRITE_REJECTED');
      const commit = value.data?.createCommitOnBranch?.commit;
      if (!shaPattern.test(commit?.oid || '')) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
      return {sha:commit.oid,url:commit.url};
    }
  };
}
function identifiedPull(r, pull) {
  if (!pull || pull.number !== r.pr || pull.repository?.toLowerCase() !== r.repo.toLowerCase() ||
      pull.sha !== r.sha || typeof pull.merged !== 'boolean') fail('SIDECAR_PULL_REQUEST_CONFLICT');
  if (pull.merged && (pull.state !== 'closed' || !shaPattern.test(pull.mergeCommit || ''))) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  return pull;
}
function pinnedPull(r, pull) {
  const identified = identifiedPull(r, pull);
  if (identified.base !== r.baseBranch) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  return identified;
}
function mergeReceipt(r, pull, flags = {}) {
  return {repository:r.repo,number:r.pr,sha:r.sha,head:pull.head,base:pull.base,url:pull.url,
    merged:true,mergeCommit:pull.mergeCommit,method:'merge',reused:false,...flags};
}
function mergeChecksReady(r, checks) {
  const statuses=checks?.statuses,workflows=checks?.workflows;
  const runsOK = runs => Array.isArray(runs) && runs.every(run => run.sha === r.sha &&
    run.status === 'completed' && ['success','neutral','skipped'].includes(run.conclusion));
  return checks?.repository?.toLowerCase() === r.repo.toLowerCase() && checks.sha === r.sha && checks.complete === true &&
    runsOK(checks.runs) && checks.total === checks.runs.length &&
    Array.isArray(statuses?.statuses) && statuses.total === statuses.statuses.length &&
    (statuses.total === 0 || statuses.state === 'success') && statuses.statuses.every(status => status.state === 'success') &&
    checks.runs.length + statuses.statuses.length > 0 && runsOK(workflows?.runs) && workflows.total === workflows.runs.length;
}
function executeMerge(r, port) {
  let pull=pinnedPull(r,port.pull(r.repo,r.pr));
  if (pull.merged) return mergeReceipt(r,pull,{reused:true});
  const ready = value => {
    if (value.state !== 'open' || value.draft !== false || value.mergeable !== true) fail('SIDECAR_MERGE_NOT_READY');
  };
  ready(pull);
  if (!mergeChecksReady(r,port.checks(r.repo,r.sha))) fail('SIDECAR_MERGE_CHECKS_NOT_READY');
  // Re-read after CI inspection; the API also pins the approved head atomically.
  pull=pinnedPull(r,port.pull(r.repo,r.pr));
  if (pull.merged) return mergeReceipt(r,pull,{reused:true});
  ready(pull);
  let result;
  try { result=port.mergePull(r); }
  catch (error) {
    // A lost PUT response is reconciled by read only, never by a second merge.
    try {
      const observed=pinnedPull(r,port.pull(r.repo,r.pr));
      if (observed.merged) return mergeReceipt(r,observed,{reconciled:true});
    } catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
    throw error;
  }
  if (result?.merged !== true || !shaPattern.test(result.sha || '')) fail('SIDECAR_MERGE_REJECTED');
  try { pull=pinnedPull(r,port.pull(r.repo,r.pr)); } catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
  if (!pull.merged || pull.mergeCommit !== result.sha) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  return mergeReceipt(r,pull);
}
function retargetReceipt(r, pull, flags = {}) {
  return {repository:r.repo,number:r.pr,sha:r.sha,head:pull.head,
    previousBase:r.currentBaseBranch,base:pull.base,url:pull.url,updated:true,reused:false,...flags};
}
function executeRetarget(r, port) {
  let pull=identifiedPull(r,port.pull(r.repo,r.pr));
  if (pull.merged || pull.state !== 'open') fail('SIDECAR_PULL_REQUEST_CONFLICT');
  if (pull.base === r.baseBranch) return retargetReceipt(r,pull,{reused:true});
  if (pull.base !== r.currentBaseBranch) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  let result;
  try { result=identifiedPull(r,port.updatePull(r)); }
  catch (error) {
    try {
      const observed=identifiedPull(r,port.pull(r.repo,r.pr));
      if (!observed.merged && observed.state === 'open' && observed.base === r.baseBranch) {
        return retargetReceipt(r,observed,{reconciled:true});
      }
    } catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
    throw error;
  }
  if (result.merged || result.state !== 'open' || result.base !== r.baseBranch) {
    fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  }
  try { pull=identifiedPull(r,port.pull(r.repo,r.pr)); }
  catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
  if (pull.merged || pull.state !== 'open' || pull.base !== r.baseBranch) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  return retargetReceipt(r,pull);
}
export function executeWrite(c, r, port = writePort(c)) {
  validateConfig(c); validateRequest(c,r,{checkTime:false});
  if (!writeOperations.has(r.operation)) fail('SIDECAR_REQUEST_REJECTED');
  if (pullWrites.has(r.operation)) return executePull(c,r,port.pr || pullPort(c));
  if (r.operation === 'pr-merge') return executeMerge(r,port);
  const meta = port.repository(r.repo);
  if (r.operation === 'pr-update-base') {
    if (r.baseBranch !== meta.defaultBranch) fail('SIDECAR_PROTECTED_BRANCH');
    return executeRetarget(r,port);
  }
  if (r.branch === meta.defaultBranch) fail('SIDECAR_PROTECTED_BRANCH');
  const current = port.head(r.repo,r.branch);
  if (r.operation === 'push') {
    if (current === r.sha) return {repository:r.repo,branch:r.branch,sha:r.sha,reused:true};
    if (current !== (r.expectedHead || null)) fail('SIDECAR_BRANCH_CONFLICT');
    port.push(r);
    if (port.head(r.repo,r.branch) !== r.sha) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
    return {repository:r.repo,branch:r.branch,sha:r.sha,reused:false};
  }
  if (r.operation === 'write') {
    if (current !== r.base) fail('SIDECAR_BRANCH_CONFLICT');
    const result = port.write(r);
    if (port.head(r.repo,r.branch) !== result.sha) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
    return {repository:r.repo,branch:r.branch,...result};
  }
  if (current !== r.sha) fail('SIDECAR_BRANCH_CONFLICT');
  const existing = port.pulls(r.repo,r.branch,r.baseBranch);
  const match = existing.find(p => p.base === r.baseBranch && p.head === r.branch && p.sha === r.sha && p.state === 'open');
  if (match) return {...match,reused:true};
  if (existing.length) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  const result = port.createPull(r);
  if (result.sha !== r.sha || result.base !== r.baseBranch || result.head !== r.branch ||
      result.repository?.toLowerCase() !== r.repo.toLowerCase()) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  return {...result,reused:false};
}
const pullProjection = '{number,title,body:(.body//""),state,merged,draft,sha:.head.sha,head:.head.ref,base:.base.ref,repository:.base.repo.full_name,url:.html_url,updatedAt:.updated_at,changedFiles:.changed_files,comments}';
const commentProjection = '{id,body,author:.user.login,url:.html_url}';
function pullPort(c) {
  return {
    detail:(repo,number)=>github(c,'repos/'+repo+'/pulls/'+number,pullProjection),
    edit:(r,changes)=>githubMutation(c,'repos/'+r.repo+'/pulls/'+r.pr,changes,pullProjection,'PATCH'),
    filesPage:(repo,number,page,size)=>github(c,'repos/'+repo+'/pulls/'+number+'/files?per_page='+size+'&page='+page,
      '[.[]|{filename,previous_filename,status,additions,deletions,patch:((.patch//null)|if type=="string" then .[:16384] else null end),patch_truncated:(((.patch//"")|length)>16384)}]'),
    commentsPage:(repo,number,page,size)=>github(c,'repos/'+repo+'/issues/'+number+'/comments?per_page='+size+'&page='+page,
      '[.[]|{id,body:((.body//"")[:8192]),body_truncated:(((.body//"")|length)>8192),author:.user.login,url:.html_url}]'),
    createComment:r=>githubMutation(c,'repos/'+r.repo+'/issues/'+r.pr+'/comments',{body:r.body},commentProjection),
    comment:(repo,id)=>github(c,'repos/'+repo+'/issues/comments/'+id,commentProjection)
  };
}
function pullSnapshot(r, value) {
  const p={...value,body:value?.body ?? ''};
  if (!value || p.repository?.toLowerCase() !== r.repo.toLowerCase() || p.number !== r.pr ||
      !shaPattern.test(p.sha || '') || !['open','closed'].includes(p.state) ||
      typeof p.merged !== 'boolean' || typeof p.draft !== 'boolean' ||
      !['head','base','title','body','updatedAt'].every(k=>typeof p[k] === 'string') ||
      !p.head || !p.base || p.title.length > 256 || Buffer.byteLength(p.body) > 262144 ||
      p.updatedAt.length > 64 || !Number.isFinite(Date.parse(p.updatedAt)) ||
      p.url?.toLowerCase() !== ('https://github.com/'+r.repo+'/pull/'+r.pr).toLowerCase() ||
      !['changedFiles','comments'].every(k=>Number.isSafeInteger(p[k]) && p[k]>=0)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
  if (r.sha !== undefined && p.sha !== r.sha) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  const revision=digest([p.repository.toLowerCase(),p.number,p.sha,p.head,p.base,p.state,p.merged,
    p.draft,p.title,p.body,p.updatedAt,p.changedFiles,p.comments]);
  return {...p,revision};
}
function samePullTarget(before, after) {
  return ['sha','head','base','state','merged'].every(key=>before[key] === after[key]);
}
function shortText(value, limit) {
  const text=value.slice(0,limit).replace(/[\uD800-\uDBFF]$/,'');
  return {text,truncated:text.length<value.length};
}
function commentRecord(r, value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id<1 || typeof value.body !== 'string' ||
      !['pull','issues'].some(kind=>value.url?.toLowerCase() ===
        ('https://github.com/'+r.repo+'/'+kind+'/'+r.pr+'#issuecomment-'+value.id).toLowerCase())) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
  return {id:value.id,body:value.body,author:typeof value.author==='string'?value.author:null,url:value.url};
}
function pullRows(r, p, port) {
  const files=r.operation==='pr-files', limit=r.limit || 50, size=files?20:10;
  const total=files?p.changedFiles:p.comments, rows=[], identities=new Set();
  let bytes=0, byteLimit=false, page=1, ended=false;
  while (rows.length<limit && !ended && !byteLimit) {
    const batch=(files?port.filesPage:port.commentsPage)(r.repo,r.pr,page++,size);
    if (!Array.isArray(batch) || batch.length>size) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
    ended=batch.length<size;
    for (const item of batch) {
      let row,key;
      if (files) {
        if (!item || typeof item.filename!=='string' || !item.filename || item.filename.length>1024 ||
            typeof item.status!=='string' || item.status.length>40 ||
            !['additions','deletions'].every(k=>Number.isSafeInteger(item[k]) && item[k]>=0)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
        const patch=typeof item.patch==='string'?shortText(item.patch,16384):null;
        row={filename:item.filename,status:item.status,additions:item.additions,deletions:item.deletions,
          ...(typeof item.previous_filename==='string'?{previous_filename:item.previous_filename}:{}),
          patch:patch?.text ?? null,patch_truncated:!!(patch?.truncated || item.patch_truncated)};
        key=row.filename;
      } else {
        row=commentRecord(r,item);
        const body=shortText(row.body,8192);
        row={...row,body:body.text,body_truncated:!!(body.truncated || item.body_truncated)};
        key=row.id;
      }
      if (identities.has(key)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
      if (rows.length===limit) break;
      const length=Buffer.byteLength(JSON.stringify(row));
      if (bytes+length>768*1024) {byteLimit=true;break;}
      identities.add(key);rows.push(row);bytes+=length;
    }
    if (!batch.length) break;
  }
  const after=pullSnapshot(r,port.detail(r.repo,r.pr));
  if (after.revision!==p.revision) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  const complete=!byteLimit && rows.length===total;
  return {repository:r.repo,number:r.pr,sha:p.sha,revision:p.revision,limit,total,
    complete,omitted:Math.max(0,total-rows.length),truncated:!complete,
    ...(complete?{}:{reason:byteLimit?'byte_limit':rows.length===limit?'item_limit':'upstream_gap'}),
    [files?'files':'comments']:rows,
    ...(files?{patches_complete:complete && rows.every(row=>row.patch!==null && !row.patch_truncated)}:{})};
}
export function executePull(c, r, port=pullPort(c)) {
  validateConfig(c);validateRequest(c,r,{checkTime:false});
  if (!pullReads.has(r.operation) && !pullWrites.has(r.operation)) fail('SIDECAR_REQUEST_REJECTED');
  const before=pullSnapshot(r,port.detail(r.repo,r.pr));
  if (r.operation==='pr-view') return before;
  if (r.operation==='pr-files' || r.operation==='pr-comments') return pullRows(r,before,port);
  if (r.operation==='pr-edit') {
    const changes=Object.fromEntries(['title','body'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
    const matches=p=>Object.entries(changes).every(([k,v])=>p[k]===v);
    const receipt=(p,flags={})=>({...p,updated:true,verified:true,reused:false,
      concurrency:'read-compare-write-read',...flags});
    if (matches(before)) return receipt(before,{updated:false,reused:true});
    if (before.revision!==r.revision) fail('SIDECAR_PULL_REQUEST_CONFLICT');
    const latest=pullSnapshot(r,port.detail(r.repo,r.pr));
    if (latest.revision!==r.revision) fail('SIDECAR_PULL_REQUEST_CONFLICT');
    try { port.edit(r,changes); }
    catch(error) {
      try {
        const observed=pullSnapshot(r,port.detail(r.repo,r.pr));
        if (matches(observed) && samePullTarget(before,observed)) return receipt(observed,{reconciled:true});
      } catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
      if (Number.isInteger(error.httpStatus) && error.httpStatus>=400 && error.httpStatus<500 &&
          error.httpStatus!==408) throw error;
      fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
    }
    try {
      const observed=pullSnapshot(r,port.detail(r.repo,r.pr));
      if (matches(observed) && samePullTarget(before,observed)) return receipt(observed);
    } catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
    fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  }
  // A comment is an append operation. An ambiguous POST is never automatically
  // retried or inferred from another matching comment; its durable claim stays.
  const latest=pullSnapshot(r,port.detail(r.repo,r.pr));
  if (latest.revision!==before.revision) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  let result;
  try { result=port.createComment(r); }
  catch(error) {
    // Only a definite rejection of the POST can retain upstream diagnostics.
    // Later read/validation failures cannot establish that no append occurred.
    if (Number.isInteger(error?.httpStatus) && error.httpStatus>=400 && error.httpStatus<500 &&
        error.httpStatus!==408) throw error;
    fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
  }
  try {
    const created=commentRecord(r,result);
    const confirmed=commentRecord(r,port.comment(r.repo,created.id));
    const after=pullSnapshot(r,port.detail(r.repo,r.pr));
    if (confirmed.id!==created.id || confirmed.body!==r.body ||
        confirmed.author?.toLowerCase()!==c.expectedGitHubLogin.toLowerCase() ||
        !samePullTarget(before,after)) fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN');
    return {repository:r.repo,number:r.pr,sha:r.sha,comment:confirmed,verified:true};
  } catch { fail('SIDECAR_WRITE_OUTCOME_UNCERTAIN'); }
}
export function readTextInput(path, max=65536) {
  if (typeof path!=='string' || !isAbsolute(path)) fail('SIDECAR_TEXT_INPUT_REJECTED');
  const checked=noLinks(path);
  if (!lstatSync(checked).isFile()) fail('SIDECAR_TEXT_INPUT_REJECTED');
  const fd=openSync(checked,'r');
  try {
    const stat=fstatSync(fd);
    if (!stat.isFile()) fail('SIDECAR_TEXT_INPUT_REJECTED');
    if (stat.size>max) fail('SIDECAR_SIZE_REJECTED');
    const buffer=Buffer.alloc(max+1);
    let count=0;
    while (count<buffer.length) {
      const read=readSync(fd,buffer,count,buffer.length-count,count);
      if (!read) break;
      count+=read;
    }
    if (count>max) fail('SIDECAR_SIZE_REJECTED');
    try { return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count)).replace(/^\uFEFF/,''); }
    catch { fail('SIDECAR_TEXT_INPUT_REJECTED'); }
  } finally { closeSync(fd); }
}

function mergeInfoPort(c) {
  return {
    pull:writePort(c).pull,
    repository:repo=>github(c,'repos/'+repo,
      '{name:.full_name,defaultBranch:.default_branch,allow_merge_commit,allow_squash_merge,allow_rebase_merge,permissions}'),
    branch:(repo,base)=>github(c,'repos/'+repo+'/branches/'+encodeURIComponent(base),
      '{name,sha:.commit.sha,protected}'),
    protection:(repo,base)=>github(c,'repos/'+repo+'/branches/'+encodeURIComponent(base)+'/protection',
      '{enforce_admins,required_linear_history,required_status_checks,required_pull_request_reviews,restrictions_enabled:(.restrictions!=null)}'),
    rules:(repo,base)=>github(c,'repos/'+repo+'/rules/branches/'+encodeURIComponent(base),
      '[.[]|{type,parameters:{required_approving_review_count:.parameters.required_approving_review_count,allowed_merge_methods:.parameters.allowed_merge_methods}}]')
  };
}
function diagnosticPolicy(read, project) {
  try { return {available:true,...project(read())}; }
  catch(error) {
    if(!/^SIDECAR_(UPSTREAM_|COMMAND_TIMEOUT)/.test(error?.code || '')) throw error;
    return {available:false,error:projectedError(error)};
  }
}
function safeContext(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _./():-]{0,119}$/.test(value) &&
    !/gh[pousr]_|github_pat_|token|secret|password|cookie|authorization|bearer|https?:|[A-Za-z]:\//i.test(value);
}
function mergeInfo(c,r,port) {
  validateConfig(c); validateRequest(c,r,{checkTime:false});
  const pull=pinnedPull(r,port.pull(r.repo,r.pr));
  const repo=port.repository(r.repo),branch=port.branch(r.repo,r.baseBranch);
  if(repo?.name?.toLowerCase() !== r.repo.toLowerCase() || branch?.name !== r.baseBranch ||
      !shaPattern.test(branch.sha || '')) fail('SIDECAR_PULL_REQUEST_CONFLICT');
  const bool=value=>typeof value === 'boolean' ? value : null;
  const count=value=>Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
  const protection=diagnosticPolicy(()=>port.protection(r.repo,r.baseBranch),p=>{
    const checks=p?.required_status_checks?.checks || (p?.required_status_checks?.contexts || []).map(context=>({context}));
    return {strict:bool(p?.required_status_checks?.strict),
      requiredLinearHistory:bool(p?.required_linear_history?.enabled),
      enforceAdmins:bool(p?.enforce_admins?.enabled),
      requiredApprovals:count(p?.required_pull_request_reviews?.required_approving_review_count),
      codeOwnerReviews:bool(p?.required_pull_request_reviews?.require_code_owner_reviews),
      restrictionsEnabled:bool(p?.restrictions_enabled),
      requiredStatusChecks:Array.isArray(checks) ? checks.slice(0,100).filter(x=>safeContext(x?.context)).map(x=>({
        context:x.context,appId:Number.isInteger(x.app_id) ? x.app_id : null})) : [],
      statusCheckCount:Array.isArray(checks) ? checks.length : null};
  });
  const rules=diagnosticPolicy(()=>port.rules(r.repo,r.baseBranch),values=>{
    if(!Array.isArray(values)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
    return {complete:values.length <= 100,items:values.slice(0,100)
      .filter(v=>typeof v?.type === 'string' && /^[a-z_]{1,80}$/.test(v.type))
      .map(v=>({type:v.type,requiredApprovals:count(v.parameters?.required_approving_review_count),
        allowedMergeMethods:Array.isArray(v.parameters?.allowed_merge_methods) ?
          v.parameters.allowed_merge_methods.filter(m=>['merge','squash','rebase'].includes(m)) : null}))};
  });
  pinnedPull(r,port.pull(r.repo,r.pr));
  return {repository:r.repo,number:r.pr,sha:r.sha,base:r.baseBranch,readOnly:true,
    pull:{state:pull.state,merged:pull.merged,draft:bool(pull.draft),mergeable:bool(pull.mergeable)},
    branch:{sha:branch.sha,protected:bool(branch.protected)},
    mergeMethods:{merge:bool(repo.allow_merge_commit),squash:bool(repo.allow_squash_merge),rebase:bool(repo.allow_rebase_merge)},
    permissions:{admin:bool(repo.permissions?.admin),push:bool(repo.permissions?.push),pull:bool(repo.permissions?.pull)},
    protection,rules};
}
function checkLogPort(c) {
  return {
    job:(repo,id)=>github(c,'repos/'+repo+'/actions/jobs/'+id,
      '{id,runId:.run_id,sha:.head_sha,name,status,conclusion,url:.html_url,steps:[.steps[]|{name,number,status,conclusion}]}'),
    log:(repo,id)=>native(c.ghPath,['run','view','--repo',repo,'--job',String(id),'--log-failed'],
      {env:userEnvironment(c),api:{method:'GET',resource:'workflow_jobs'}})
  };
}
export function executeCheckLog(c,r,port=checkLogPort(c)) {
  validateConfig(c);validateRequest(c,r,{checkTime:false});
  if (r.operation!=='check-log') fail('SIDECAR_REQUEST_REJECTED');
  function pinned(value) {
    if (!value || value.id!==r.job || value.sha!==r.sha ||
        !Number.isSafeInteger(value.runId) || value.runId<1 || value.status!=='completed' ||
        value.url?.toLowerCase()!==('https://github.com/'+r.repo+'/actions/runs/'+value.runId+'/job/'+r.job).toLowerCase()) fail('SIDECAR_CHECK_JOB_CONFLICT');
    if (typeof value.name!=='string' || value.name.length>1024 || !Array.isArray(value.steps) ||
        value.steps.length>100 || value.steps.some(step=>!step || typeof step.name!=='string' ||
          step.name.length>1024 || !Number.isSafeInteger(step.number) || step.number<1)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
    return value;
  }
  const before=pinned(port.job(r.repo,r.job)), raw=port.log(r.repo,r.job);
  const after=pinned(port.job(r.repo,r.job));
  if (after.runId!==before.runId || after.conclusion!==before.conclusion) fail('SIDECAR_CHECK_JOB_CONFLICT');
  if (typeof raw!=='string' || Buffer.byteLength(raw)>2*1024*1024) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
  // Best-effort masking of recognised token/header formats; CI output can still
  // contain private repository data and is returned only within its read scope.
  const masked=raw.replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+\b/g,'[REDACTED]')
    .replace(/((?:proxy-)?authorization\s*[:=]\s*(?:bearer|basic)\s+)\S+/gi,'$1[REDACTED]');
  const bytes=Buffer.from(masked), max=131072;
  let start=Math.max(0,bytes.length-max);
  while (start<bytes.length && (bytes[start]&0xc0)===0x80) start++;
  return {repository:r.repo,sha:r.sha,job:r.job,run:before.runId,url:before.url,name:before.name,
    status:before.status,conclusion:before.conclusion,steps:before.steps,
    log:bytes.subarray(start).toString('utf8'),sourceBytes:Buffer.byteLength(raw),
    truncated:start>0,...(start>0?{reason:'tail_byte_limit'}:{}),readOnly:true};
}

export function executeRead(c, request, diagnosticPort) {
  if (request.operation==='check-log') return executeCheckLog(c,request,diagnosticPort || checkLogPort(c));
  if (writeOperations.has(request.operation)) return executeWrite(c,request);
  if (pullReads.has(request.operation)) return executePull(c,request,diagnosticPort || pullPort(c));
  if (request.operation === 'merge-info') return mergeInfo(c,request,diagnosticPort || mergeInfoPort(c));
  if (request.operation === 'branch') return {repository:request.repo,branch:request.branch,sha:branchHead(c,request.repo,request.branch)};
  if (request.operation === 'pr-list') return {repository:request.repo,pulls:pullRequests(c,request.repo,request.branch,request.baseBranch)};
  if (request.operation === 'account') return github(c, 'user', '{login,id}');
  if (request.operation === 'main') return mainHead(c, request.repo);
  if (request.operation === 'checks') {
    const sha = request.sha || mainHead(c, request.repo).sha;
    const result = github(c, 'repos/' + request.repo + '/commits/' + sha + '/check-runs?per_page=100',
      '{total:.total_count,runs:[.check_runs[]|{name,status,conclusion,sha:.head_sha,url:.html_url}]}');
    const statuses = github(c, 'repos/' + request.repo + '/commits/' + sha + '/status?per_page=100',
      '{state,total:.total_count,statuses:[.statuses[]|{context,state,url:.target_url}]}');
    const workflows = github(c, 'repos/' + request.repo + '/actions/runs?head_sha=' + sha + '&per_page=100',
      '{total:.total_count,runs:[.workflow_runs[]|{name,status,conclusion,sha:.head_sha,event,url:.html_url}]}');
    if (result.runs.some(r => r.sha !== sha) || workflows.runs.some(r => r.sha !== sha)) fail('SIDECAR_UPSTREAM_RESPONSE_REJECTED');
    return { repository: request.repo, sha, complete: result.total === result.runs.length &&
      statuses.total === statuses.statuses.length && workflows.total === workflows.runs.length, ...result, statuses, workflows };
  }
  if (request.operation === 'source') return source(c, request);
  fail('SIDECAR_REQUEST_REJECTED');
}
function taskCommand(c, query = false) {
  const system = process.env.SystemRoot || 'C:\\Windows';
  const module = join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules', 'ScheduledTasks', 'ScheduledTasks.psd1').replace(/'/g, "''");
  const script = "Import-Module '" + module + "'; " + (query
    ? "$t=Get-ScheduledTask -TaskPath '\\' -TaskName '" + c.taskName + "'; $i=Get-ScheduledTaskInfo -TaskPath '\\' -TaskName '" + c.taskName + "'; @{state=[string]$t.State;result=$i.LastTaskResult}|ConvertTo-Json -Compress"
    : "Start-ScheduledTask -TaskPath '\\' -TaskName '" + c.taskName + "'");
  return native(join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script]);
}
async function call(c, payload, id) {
  const request = enqueue(c, payload, {id});
  const cached = readReply(c,request); if (cached) return cached;
  if (writeOperations.has(payload.operation)) console.error(JSON.stringify({requestId:request.id,operation:payload.operation,phase:'submitted'}));
  taskCommand(c);
  const deadline = Date.now() + (['source','push','pr-merge'].includes(payload.operation) ? 230_000 : 65_000);
  let nextCheck = Date.now() + 3000, starts = 1;
  while (Date.now() < deadline) {
    const reply = readReply(c, request);
    if (reply) return reply;
    await delay(300);
    if (Date.now() < nextCheck) continue;
    const state = JSON.parse(taskCommand(c, true)); nextCheck = Date.now() + 3000;
    if (state.state !== 'Running') {
      if (existsSync(inside(c.root, 'queue', request.id + '.running'))) fail('SIDECAR_INTERRUPTED');
      if (starts++ >= 3) fail('SIDECAR_USER_SESSION_UNAVAILABLE');
      taskCommand(c);
    }
  }
  fail('SIDECAR_RESPONSE_TIMEOUT');
}
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--worker') { options.worker = true; continue; }
    if (!['--config','--operation','--repo','--sha','--branch','--base','--expected-head','--base-branch','--current-base-branch',
      '--checkout','--request-id','--title-file','--body-file','--changes-file','--pr','--expected-revision','--limit','--job'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || options[key.slice(2)] !== undefined) fail('SIDECAR_ARGUMENT_REJECTED');
    options[key.slice(2)] = argv[++i];
  }
  return options;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(args.config || fileURLToPath(new URL('../state/github-user-sidecar/config.json', import.meta.url)));
  const c = validateConfig(json(configPath, 64 * 1024));
  if (!samePath(dirname(configPath),c.root)) fail('SIDECAR_CONFIG_REJECTED');
  if (args.worker) {
    const self = fileURLToPath(import.meta.url);
    if (!samePath(c.workerPath,self) || digest(readFileSync(self, 'utf8')) !== c.workerSHA256) fail('SIDECAR_WORKER_CHANGED');
    const identity = native(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
    const observedSid = identity.match(/S-1-5-21-(?:\d+-){2,}\d+/)?.[0];
    let account;
    const processed = await processPending(c, { observedSid, execute: request => {
      account ||= github(c, 'user', '{login,id}');
      if (typeof c.expectedGitHubLogin !== 'string' || account.login?.toLowerCase() !== c.expectedGitHubLogin.toLowerCase()) {
        fail('SIDECAR_GITHUB_ACCOUNT_MISMATCH');
      }
      return request.operation === 'account' ? account : executeRead(c, request);
    } });
    console.log(JSON.stringify({ processed })); return;
  }
  if (args.operation === 'result') {
    const result=requestResult(c,args['request-id']); console.log(JSON.stringify(result,null,2)); if(!result.ok) process.exitCode=1; return;
  }
  let payload = { operation: args.operation };
  const id = args['request-id'] || randomUUID();
  const previousPath=inside(c.root,'requests',id+'.json');
  if (args.operation === 'push' && existsSync(previousPath)) {
    const previous=json(previousPath,3*1024*1024);
    if (previous.operation !== 'push' || ['repo','branch','sha','base'].some(k=>previous[k] !== args[k]) ||
        previous.expectedHead !== args['expected-head']) fail('SIDECAR_REQUEST_ID_REUSED');
    payload=Object.fromEntries(Object.entries(previous).filter(([key])=>!['schemaVersion','installationId','id','issuedAt','expiresAt'].includes(key)));
  } else if (args.operation === 'push') {
    payload = preparePush(c,{repo:args.repo,checkout:args.checkout,branch:args.branch,sha:args.sha,
      base:args.base,expectedHead:args['expected-head']},id);
  } else {
    for (const key of ['repo','sha','branch','base']) if (args[key] !== undefined) payload[key] = args[key];
    if (args['base-branch'] !== undefined) payload.baseBranch = args['base-branch'];
    if (args['current-base-branch'] !== undefined) payload.currentBaseBranch = args['current-base-branch'];
    if (args['expected-revision'] !== undefined) payload.revision=args['expected-revision'];
    if (args.job !== undefined) {
      if (!/^[1-9][0-9]{0,15}$/.test(args.job) || !Number.isSafeInteger(Number(args.job))) fail('SIDECAR_ARGUMENT_REJECTED');
      payload.job=Number(args.job);
    }
    if (args.limit !== undefined) {
      if (!/^[1-9][0-9]{0,2}$/.test(args.limit)) fail('SIDECAR_ARGUMENT_REJECTED');
      payload.limit=Number(args.limit);
    }
    if (args.operation==='pr-edit') {
      if (args['title-file'] !== undefined) payload.title=readTextInput(args['title-file'],1024).trim();
      if (args['body-file'] !== undefined) payload.body=readTextInput(args['body-file']);
    }
    if (args.operation==='pr-comment') payload.body=readTextInput(args['body-file']);
    if (args.pr !== undefined) {
      if (!/^[1-9][0-9]{0,9}$/.test(args.pr)) fail('SIDECAR_ARGUMENT_REJECTED');
      payload.pr=Number(args.pr);
    }
    if (args.operation === 'pr-create') {
      payload.title = readFileSync(noLinks(args['title-file']),'utf8').replace(/^\uFEFF/,'').trim();
      payload.body = readFileSync(noLinks(args['body-file']),'utf8').replace(/^\uFEFF/,'');
    }
    if (args.operation === 'write') {
      const changes = json(noLinks(args['changes-file']),3*1024*1024);
      if (Object.keys(changes).some(k=>!['message','files'].includes(k))) fail('SIDECAR_REQUEST_REJECTED');
      payload.message = changes.message; payload.files = changes.files;
    }
  }
  const reply = await call(c, payload, id);
  console.log(JSON.stringify(reply, null, 2));
  if (!reply.ok) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, error: projectedError(error) })); process.exitCode = 1; });
}
