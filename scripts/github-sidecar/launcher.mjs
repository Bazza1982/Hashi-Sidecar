import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function reject(code) { const error = new Error(code); error.code = code; throw error; }
function safePath(root, name) {
  if (typeof name !== 'string' || isAbsolute(name) || /^[a-z]:/i.test(name)) reject('SHARED_SIDECAR_PATH_REJECTED');
  const path = resolve(root, name), rel = relative(resolve(root), path);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) reject('SHARED_SIDECAR_PATH_REJECTED');
  let cursor = path;
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) reject('SHARED_SIDECAR_PATH_REJECTED');
    const parent = dirname(cursor); if (cursor === parent) break; cursor = parent;
  }
  return path;
}
function samePath(a,b) {
  const names=[a,b].map(path=>realpathSync.native(safePath(path,'.')));
  return process.platform==='win32'?names[0].toLowerCase()===names[1].toLowerCase():names[0]===names[1];
}
function readJSON(path) {
  const bytes = readFileSync(path);
  if (bytes.length > 64 * 1024) reject('SHARED_SIDECAR_MANIFEST_REJECTED');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
export function readInstallation(root) {
  const manifest = readJSON(safePath(root, 'installation.json'));
  if (manifest.schemaVersion !== 1 || manifest.name !== 'hashi-github-sidecar' ||
      !/^\d+\.\d+\.\d+$/.test(manifest.version || '') ||
      !new RegExp('^' + manifest.version.replaceAll('.', '\\.') + '-[0-9a-f]{12}$').test(manifest.releaseId || '') ||
      manifest.config !== 'data/config.json') reject('SHARED_SIDECAR_MANIFEST_REJECTED');
  const expected = { launcher: 'bin/launcher.mjs', executable: 'bin/hashi-github.exe',
    runtime: 'runtime/node.exe', license: 'runtime/LICENSE',
    worker: 'releases/' + manifest.releaseId + '/github-user-sidecar.mjs' };
  const files = {};
  for (const [name, path] of Object.entries(expected)) {
    const entry = manifest.files?.[name];
    if (!entry || entry.path !== path || !/^[0-9a-f]{64}$/.test(entry.sha256 || '')) reject('SHARED_SIDECAR_MANIFEST_REJECTED');
    files[name] = safePath(root, path);
    const actual = createHash('sha256').update(readFileSync(files[name])).digest('hex');
    if (actual !== entry.sha256) reject('SHARED_SIDECAR_INTEGRITY_REJECTED');
  }
  return { root: resolve(root), manifest, files, config: safePath(root, manifest.config) };
}
export function operationArguments(argv) {
  if (!argv.length || (argv.length === 1 && ['help', '--help', '-h'].includes(argv[0]))) return { command: 'help' };
  if (argv.length === 1 && ['version', '--version'].includes(argv[0])) return { command: 'version' };
  if (argv.length === 1 && argv[0] === 'status') return { command: 'status' };
  const tokens = [...argv];
  if (tokens[0] === '--operation') tokens.shift();
  const operation = tokens.shift();
  const required = {
    account: [], main: ['repo'], checks: ['repo'], 'check-log':['repo','sha','job'], source: ['repo'],
    branch: ['repo','branch'], 'pr-list': ['repo','branch'],
    'merge-info': ['repo','pr','sha','base-branch'],
    push: ['repo','checkout','branch','sha','base'], write: ['repo','branch','base','changes-file'],
    'pr-create': ['repo','branch','sha','base-branch','title-file','body-file'],
    'pr-merge': ['repo','pr','sha','base-branch'],
    'pr-update-base': ['repo','pr','sha','current-base-branch','base-branch'], result: ['request-id'],
    'pr-view': ['repo','pr'], 'pr-files': ['repo','pr'], 'pr-comments': ['repo','pr'],
    'pr-edit': ['repo','pr','sha','expected-revision'],
    'pr-comment': ['repo','pr','sha','body-file'],
  };
  const optional = {checks:['sha'],source:['sha'],'pr-list':['base-branch'],push:['expected-head','request-id'],
    write:['request-id'],'pr-create':['request-id'],'pr-merge':['request-id'],'pr-update-base':['request-id'],
    'pr-view':['sha'],'pr-files':['sha','limit'],'pr-comments':['sha','limit'],
    'pr-edit':['title-file','body-file','request-id'],'pr-comment':['request-id']};
  if (!Object.hasOwn(required,operation)) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  const permitted = [...required[operation],...(optional[operation] || [])].map(k=>'--'+k);
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index], value = tokens[index + 1];
    if (!permitted.includes(key) || options[key] !== undefined || !value || value.startsWith('--') ||
        value.length > 32767) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
    options[key] = value;
  }
  if (required[operation].some(k=>options['--'+k] === undefined)) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (options['--repo'] !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options['--repo'])) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  for (const key of ['--sha','--base','--expected-head']) {
    if (options[key] !== undefined && !/^[0-9a-f]{40}$/.test(options[key])) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  }
  if (options['--pr'] !== undefined && (!/^[1-9][0-9]{0,9}$/.test(options['--pr']) ||
      Number(options['--pr']) > 2_147_483_647)) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (options['--request-id'] !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options['--request-id'])) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (options['--job']!==undefined && (!/^[1-9][0-9]{0,15}$/.test(options['--job']) || !Number.isSafeInteger(Number(options['--job'])))) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (operation==='pr-edit' && options['--title-file']===undefined && options['--body-file']===undefined) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (options['--expected-revision']!==undefined && !/^[a-f0-9]{64}$/.test(options['--expected-revision'])) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (options['--limit']!==undefined && (!/^[1-9][0-9]{0,2}$/.test(options['--limit']) || Number(options['--limit'])>100)) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  if (['pr-edit','pr-comment'].includes(operation) && ['--title-file','--body-file'].some(key=>options[key]!==undefined && !isAbsolute(options[key]))) reject('SHARED_SIDECAR_ARGUMENT_REJECTED');
  return { command: operation, argv: ['--operation', operation, ...Object.entries(options).flat()] };
}
async function configuration(installation) {
  const config = readJSON(installation.config);
  const { validateConfig } = await import(pathToFileURL(installation.files.worker).href);
  validateConfig(config);
  if (!samePath(config.root,resolve(installation.root,'data')) ||
      !samePath(config.workerPath,installation.files.worker) ||
      config.workerSHA256 !== installation.manifest.files.worker.sha256) reject('SHARED_SIDECAR_CONFIG_REJECTED');
  return config;
}
async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const operation = operationArguments(process.argv.slice(2));
  const installation = readInstallation(root);
  if (!samePath(process.execPath,installation.files.runtime)) reject('SHARED_SIDECAR_RUNTIME_REJECTED');
  if (operation.command === 'help') {
    console.log('HASHI GitHub Sidecar ' + installation.manifest.version + '\n' +
      'Usage: hashi-github.exe account | main --repo OWNER/REPO | checks --repo OWNER/REPO [--sha COMMIT] | source --repo OWNER/REPO [--sha COMMIT]\n' +
      'Writes: push --repo OWNER/REPO --checkout PATH --branch BRANCH --sha COMMIT --base COMMIT [--expected-head COMMIT]\n' +
      '        write --repo OWNER/REPO --branch BRANCH --base COMMIT --changes-file JSON\n' +
      '        pr-create --repo OWNER/REPO --branch BRANCH --sha COMMIT --base-branch main --title-file TXT --body-file MD\n' +
      '        pr-merge --repo OWNER/REPO --pr NUMBER --sha APPROVED_COMMIT --base-branch main\n' +
      '        pr-update-base --repo OWNER/REPO --pr NUMBER --sha COMMIT --current-base-branch BRANCH --base-branch main\n' +
      '        pr-edit --repo OWNER/REPO --pr NUMBER --sha COMMIT --expected-revision DIGEST [--title-file TXT] [--body-file MD]\n' +
      '        pr-comment --repo OWNER/REPO --pr NUMBER --sha COMMIT --body-file MD [--request-id UUID]\n' +
      'Reads: branch/pr-list --repo OWNER/REPO --branch BRANCH; result --request-id UUID\n' +
      '       merge-info --repo OWNER/REPO --pr NUMBER --sha COMMIT --base-branch main\n' +
      '       check-log --repo OWNER/REPO --sha COMMIT --job JOB_ID\n' +
      '       pr-view --repo OWNER/REPO --pr NUMBER [--sha COMMIT]\n' +
      '       pr-files/pr-comments --repo OWNER/REPO --pr NUMBER [--sha COMMIT] [--limit 1..100]\n' +
      'Local commands: status, version, --help\n' +
      'Use HASHI managed execution. Repository scope is configured by the operator.\n' +
      'The configured Windows user must remain logged on. Credentials stay in the user keyring.');
    return;
  }
  if (operation.command === 'version') {
    console.log(JSON.stringify({ name: installation.manifest.name, version: installation.manifest.version,
      releaseId: installation.manifest.releaseId, node: process.version, executable: installation.files.executable }, null, 2));
    return;
  }
  const config = await configuration(installation);
  if (operation.command === 'status') {
    const system = process.env.SystemRoot;
    if (!system) reject('SHARED_SIDECAR_ENVIRONMENT_REJECTED');
    const script = "$t=Get-ScheduledTask -TaskPath '\\' -TaskName '" + config.taskName +
      "'; $i=Get-ScheduledTaskInfo -TaskPath '\\' -TaskName '" + config.taskName +
      "'; @{state=[string]$t.State;result=$i.LastTaskResult;logon=[string]$t.Principal.LogonType;runLevel=[string]$t.Principal.RunLevel}|ConvertTo-Json -Compress";
    const result = spawnSync(join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    if (result.status !== 0) reject('SHARED_SIDECAR_TASK_UNAVAILABLE');
    console.log(JSON.stringify({ ok: true, version: installation.manifest.version, root,
      executable: installation.files.executable, config: installation.config, taskName: config.taskName,
      task: JSON.parse(result.stdout), account: config.expectedGitHubLogin, repositories: config.repositories,
      repositoryScope: config.repositoryScope || 'list', writeRepositoryScope: config.writeRepositoryScope || 'list',
      repositoryOwner: config.expectedGitHubLogin, writeRepositories: config.writeRepositories || [],
      operations: (await import(pathToFileURL(installation.files.worker).href)).supportedOperations(),
      credentialSource: 'Windows user keyring', requiresLoggedOnUser: true }, null, 2));
    return;
  }
  const result = spawnSync(installation.files.runtime, [installation.files.worker, '--config', installation.config, ...operation.argv],
    { cwd: root, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 2;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    const code = /^SHARED_SIDECAR_[A-Z_]+$/.test(error.code || '') ? error.code :
      error.code === 'EACCES' || error.code === 'EPERM' ? 'SHARED_SIDECAR_CALLER_ACCESS_DENIED' : 'SHARED_SIDECAR_UNAVAILABLE';
    console.error(JSON.stringify({ ok: false, error: { code } })); process.exitCode = 2;
  });
}
