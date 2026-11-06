import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { operationArguments, readInstallation } from '../scripts/github-sidecar/launcher.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hub shared-github & '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const releaseId = '1.0.0-012345abcdef';
  const paths = { launcher: 'bin/launcher.mjs', executable: 'bin/hashi-github.exe', runtime: 'runtime/node.exe',
    license: 'runtime/LICENSE', worker: 'releases/' + releaseId + '/github-user-sidecar.mjs' };
  const manifest = { schemaVersion: 1, name: 'hashi-github-sidecar', version: '1.0.0', releaseId,
    config: 'data/config.json', files: {} };
  for (const [name, path] of Object.entries(paths)) {
    const target = join(root, path); mkdirSync(dirname(target), { recursive: true });
    const bytes = Buffer.from('synthetic ' + name); writeFileSync(target, bytes);
    manifest.files[name] = { path, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const save = () => writeFileSync(join(root, 'installation.json'), JSON.stringify(manifest));
  save(); return { root, manifest, save };
}

test('shared GitHub package persists a complete release and rejects tampered worker bytes', t => {
  const f = fixture(t), first = readInstallation(f.root);
  assert.equal(first.manifest.version, '1.0.0');
  assert.equal(readInstallation(f.root).manifest.releaseId, first.manifest.releaseId);
  writeFileSync(first.files.worker, 'altered executable payload');
  assert.throws(() => readInstallation(f.root), /SHARED_SIDECAR_INTEGRITY_REJECTED/);
});

test('shared GitHub package rejects escaped and reparse-point release paths', t => {
  const f = fixture(t);
  f.manifest.files.worker.path = '../foreign/worker.mjs'; f.save();
  assert.throws(() => readInstallation(f.root), /SHARED_SIDECAR_MANIFEST_REJECTED/);
  const g = fixture(t), alias = join(g.root, 'alias');
  symlinkSync(join(g.root, 'releases'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  g.manifest.files.worker.path = 'alias/1.0.0-012345abcdef/github-user-sidecar.mjs'; g.save();
  assert.throws(() => readInstallation(g.root), /SHARED_SIDECAR_MANIFEST_REJECTED/);
  const rootAlias = g.root + '-alias';
  symlinkSync(g.root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => rmSync(rootAlias, { recursive: true, force: true }));
  assert.throws(() => readInstallation(rootAlias), /SHARED_SIDECAR_PATH_REJECTED/);
});

test('shared GitHub CLI accepts the documented reads and rejects worker/config/command injection', () => {
  assert.deepEqual(operationArguments(['main','--repo','example/one']).argv, ['--operation','main','--repo','example/one']);
  assert.equal(operationArguments(['--help']).command, 'help');
  assert.equal(operationArguments(['status']).command, 'status');
  for (const argv of [
    ['--worker'], ['account','--config','elsewhere'], ['main','--repo','example/one&calc.exe'],
    ['checks','--repo','example/one','--sha','--help'], ['source','--repo','example/one','--target','foreign'],
    ['main','--repo','example/one','--repo','example/two'], ['account','--repo','example/one']
  ]) assert.throws(() => operationArguments(argv), /SHARED_SIDECAR_ARGUMENT_REJECTED/);
});

test('native GitHub executable preserves argv literally and runs independently of caller directory', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const source = fileURLToPath(new URL('../scripts/github-sidecar/Launcher.cs', import.meta.url));
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  assert.equal(existsSync(compiler), true, 'Windows C# compiler required for the native launcher check');
  const exe = join(f.root, 'bin/hashi-github.exe');
  rmSync(exe);
  const compile = spawnSync(compiler, ['/nologo','/target:exe','/platform:anycpu','/out:' + exe, source], { encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  copyFileSync(process.execPath, join(f.root, 'runtime/node.exe'));
  writeFileSync(join(f.root, 'bin/launcher.mjs'), 'console.log(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));');
  const caller = join(f.root, 'different caller'); mkdirSync(caller);
  const sentinel = join(f.root, 'unexpected-command.txt');
  const argv = ['space value', 'quote"value', 'trailing\\', '中文', '&echo unexpected > ' + sentinel, ''];
  const run = spawnSync(exe, argv, { cwd: caller, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).argv, argv);
  assert.equal(realpathSync.native(JSON.parse(run.stdout).cwd), realpathSync.native(f.root));
  assert.equal(existsSync(sentinel), false, 'argv text must never be executed by a shell');
});
