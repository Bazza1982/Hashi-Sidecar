import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { enqueue, processPending, readReply, preparePush, publishBundle, executeWrite, requestResult } from '../scripts/github-user-sidecar.mjs';
import { operationArguments } from '../scripts/github-sidecar/launcher.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'github-write-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { schemaVersion: 1, installationId: 'ff00599c-abcd-4b33-9111-00ee66aa44bb',
    root, userSid: 'S-1-5-21-11-22-33-1001', expectedGitHubLogin: 'operator',
    taskName: 'HashiHubV2-GitHubRead-test', taskPath: '\\', userProfile: root,
    ghPath: process.execPath, gitPath: process.execPath, workerPath: join(root, 'worker.mjs'),
    workerSHA256: 'a'.repeat(64), repositories: ['example/one'], writeRepositories: ['example/one'] };
  for (const name of ['queue', 'responses', 'sources', 'hooks', 'uploads', 'requests', 'claims', 'work']) mkdirSync(join(root, name));
  return { root, config };
}

test('authorized write operations persist and reuse their durable receipt without executing twice', async t => {
  const f = fixture(t);
  const request = enqueue(f.config, { operation: 'pr-create', repo: 'example/one',
    branch: 'fix/policy', baseBranch: 'main', sha: 'b'.repeat(40),
    title: 'Preserve policy', body: 'A bounded PR.' });
  let calls = 0;
  await processPending(f.config, { observedSid: f.config.userSid, execute: async r => {
    calls++; assert.equal(r.branch, 'fix/policy');
    return { number: 12, url: 'https://github.com/example/one/pull/12' };
  } });
  assert.equal(readReply(f.config, request).data.number, 12);
  assert.equal(calls, 1);
  const again = enqueue(f.config, { operation: 'pr-create', repo: 'example/one',
    branch: 'fix/policy', baseBranch: 'main', sha: 'b'.repeat(40),
    title: 'Preserve policy', body: 'A bounded PR.' }, { id: request.id });
  assert.deepEqual(again, request);
  await processPending(f.config, { observedSid: f.config.userSid, execute: async () => { calls++; } });
  assert.equal(calls, 1);
  assert.throws(() => enqueue(f.config, { operation: 'pr-create', repo: 'example/one',
    branch: 'fix/other', baseBranch: 'main', sha: 'b'.repeat(40), title: 'Changed', body: '' },
    { id: request.id }), /SIDECAR_REQUEST_ID_REUSED/);
});

test('shared CLI accepts pinned push, repository writes, PR creation and result inspection', () => {
  assert.equal(operationArguments(['push', '--repo', 'example/one', '--checkout', 'C:/dev/source',
    '--branch', 'fix/policy', '--sha', 'b'.repeat(40), '--base', 'a'.repeat(40)]).command, 'push');
  assert.equal(operationArguments(['write', '--repo', 'example/one', '--branch', 'fix/policy',
    '--base', 'a'.repeat(40), '--changes-file', 'C:/dev/changes.json']).command, 'write');
  assert.equal(operationArguments(['pr-create', '--repo', 'example/one', '--branch', 'fix/policy',
    '--sha', 'b'.repeat(40), '--base-branch', 'main', '--title-file', 'C:/dev/title.txt',
    '--body-file', 'C:/dev/body.md']).command, 'pr-create');
  assert.equal(operationArguments(['result', '--request-id', 'ff00599c-abcd-4b33-9111-00ee66aa44bb']).command, 'result');
});


test('writes require the configured write scope and reject protected refs, path escape and command fields', t => {
  const f = fixture(t), common = {operation:'write',repo:'example/one',branch:'fix/policy',base:'a'.repeat(40),
    message:'Update',files:[{path:'docs/result.txt',content:Buffer.from('ok').toString('base64')}]};
  assert.throws(()=>enqueue({...f.config,writeRepositories:[]},common),/SIDECAR_WRITE_SCOPE_REJECTED/);
  for (const changed of [
    {branch:'main'}, {branch:'master'}, {branch:'fix/../main'}, {repo:'foreign/private'}, {command:'whoami'},
    {base:'--help'}, {files:[{path:'../outside',content:''}]}, {files:[{path:'.GIT/config',content:''}]},
    {files:[{path:'C:/private',content:''}]}, {files:[{path:'docs/a',content:'bad base64!'}]},
    {files:[{path:'docs/a',content:'',delete:true}]},
  ]) assert.throws(()=>enqueue(f.config,{...common,...changed}),/SIDECAR_(REQUEST_REJECTED|PROTECTED_BRANCH)/);
  const request = enqueue(f.config,{...common,branch:'release'});
  assert.throws(()=>executeWrite(f.config,request,{
    repository:()=>({defaultBranch:'release'}),head:()=>assert.fail('protected ref must stop before mutation')
  }),/SIDECAR_PROTECTED_BRANCH/);
});

test('a previously claimed interrupted write is never executed again and remains inspectable', async t => {
  const f=fixture(t);
  const request=enqueue(f.config,{operation:'write',repo:'example/one',branch:'fix/result',base:'a'.repeat(40),
    message:'A durable write',files:[{path:'result.txt',content:''}]});
  writeFileSync(join(f.root,'claims',request.id+'.json'),JSON.stringify({startedAt:new Date().toISOString()}));
  let calls=0;
  await processPending(f.config,{observedSid:f.config.userSid,execute:()=>{calls++;}});
  assert.equal(calls,0);
  assert.equal(requestResult(f.config,request.id).error.code,'SIDECAR_WRITE_OUTCOME_UNCERTAIN');
});

function gitAt(cwd,args) {
  const exe=process.platform==='win32' ? join(process.env.ProgramFiles,'Git/cmd/git.exe') : '/usr/bin/git';
  const p=spawnSync(exe,['-c','protocol.file.allow=always','-c','core.hooksPath='+join(cwd,'missing-hooks'),
    '-c','commit.gpgsign=false',...args],{cwd,encoding:'utf8',windowsHide:true});
  if(p.status!==0) throw new Error(p.stdout+p.stderr);
  return p.stdout.trimEnd();
}
function repositoryFixture(t) {
  const f=fixture(t),source=join(f.root,'checkout'),remote=join(f.root,'remote.git');
  mkdirSync(source);gitAt(source,['init','--initial-branch','main']);
  gitAt(source,['config','user.name','Fixture']);gitAt(source,['config','user.email','fixture@example.invalid']);
  writeFileSync(join(source,'policy.txt'),'original');gitAt(source,['add','.']);gitAt(source,['commit','-m','Base']);
  const base=gitAt(source,['rev-parse','HEAD']);gitAt(f.root,['clone','--bare',source,remote]);
  writeFileSync(join(source,'policy.txt'),'fixed');gitAt(source,['commit','-am','Preserve policy']);
  const sha=gitAt(source,['rev-parse','HEAD']);
  f.config.gitPath=process.platform==='win32' ? join(process.env.ProgramFiles,'Git/cmd/git.exe') : '/usr/bin/git';
  const head=branch=>{
    const p=spawnSync(f.config.gitPath,['-C',remote,'rev-parse','--verify','refs/heads/'+branch],{encoding:'utf8'});
    return p.status===0?p.stdout.trim():null;
  };
  const port={repository:()=>({defaultBranch:'main'}),head:(_repo,branch)=>head(branch),
    push:r=>publishBundle(f.config,r,(args,options={})=>gitAt(options.cwd||f.root,args),remote)};
  return {...f,source,remote,base,sha,head,port};
}

test('real Git publication uses the immutable pinned bundle after the caller checkout advances', t => {
  const f=repositoryFixture(t),id=randomUUID();
  const payload=preparePush(f.config,{repo:'example/one',checkout:f.source,branch:'fix/frozen',sha:f.sha,base:f.base},id);
  const request=enqueue(f.config,payload,{id});
  writeFileSync(join(f.source,'policy.txt'),'later local work');gitAt(f.source,['commit','-am','Later work']);
  const later=gitAt(f.source,['rev-parse','HEAD']);
  assert.equal(executeWrite(f.config,request,f.port).sha,f.sha);
  assert.equal(f.head('fix/frozen'),f.sha);
  assert.equal(gitAt(f.remote,['show','refs/heads/fix/frozen:policy.txt']),'fixed');
  assert.equal(gitAt(f.source,['rev-parse','HEAD']),later);
  assert.equal(executeWrite(f.config,request,f.port).reused,true);
  assert.equal(gitAt(f.remote,['rev-parse','refs/heads/main']),f.base);
});

test('bundle tampering and competing remote work are rejected without replacing that work', t => {
  const f=repositoryFixture(t),id=randomUUID();
  const payload=preparePush(f.config,{repo:'example/one',checkout:f.source,branch:'fix/conflict',sha:f.sha,base:f.base},id);
  const request=enqueue(f.config,payload,{id});
  writeFileSync(join(f.root,'uploads',id+'.bundle'),'altered payload');
  assert.throws(()=>executeWrite(f.config,request,f.port),/SIDECAR_ARTIFACT_CHANGED/);
  assert.equal(f.head('fix/conflict'),null);
  gitAt(f.remote,['update-ref','refs/heads/fix/conflict',f.base]);
  assert.throws(()=>executeWrite(f.config,request,f.port),/SIDECAR_BRANCH_CONFLICT/);
  assert.equal(f.head('fix/conflict'),f.base);
  writeFileSync(join(f.source,'policy.txt'),'uncommitted');
  assert.throws(()=>preparePush(f.config,{repo:'example/one',checkout:f.source,branch:'fix/dirty',sha:f.sha,base:f.base}),/SIDECAR_SOURCE_CONFLICT/);
});

test('PR publication verifies the pushed commit and reconciles an existing matching PR', t => {
  const f=fixture(t),sha='b'.repeat(40);
  const r=enqueue(f.config,{operation:'pr-create',repo:'example/one',branch:'fix/ready',baseBranch:'main',
    sha,title:'Fix',body:'Exact commit.'});
  let created=0,existing=[];
  const port={repository:()=>({defaultBranch:'main'}),head:()=>sha,pulls:()=>existing,createPull:()=>{
    created++;return {number:12,state:'open',head:r.branch,sha,base:'main',repository:r.repo,url:'https://github.com/example/one/pull/12'};
  }};
  const result=executeWrite(f.config,r,port);
  assert.equal(result.number,12);assert.equal(created,1);
  existing=[result];assert.equal(executeWrite(f.config,r,port).reused,true);assert.equal(created,1);
  assert.throws(()=>executeWrite(f.config,r,{...port,head:()=> 'c'.repeat(40)}),/SIDECAR_BRANCH_CONFLICT/);
  assert.equal(created,1);
});

test('repository file commits require the exact current branch and verify the resulting head', t => {
  const f=fixture(t),base='a'.repeat(40),sha='b'.repeat(40);
  const r=enqueue(f.config,{operation:'write',repo:'example/one',branch:'fix/files',base,message:'Update',
    files:[{path:'docs/result.txt',content:Buffer.from('verified').toString('base64')}]});
  let current=base,writes=0;
  const port={repository:()=>({defaultBranch:'main'}),head:()=>current,write:input=>{
    writes++;assert.equal(Buffer.from(input.files[0].content,'base64').toString(),'verified');
    current=sha;return {sha};
  }};
  assert.equal(executeWrite(f.config,r,port).sha,sha);assert.equal(writes,1);
  assert.throws(()=>executeWrite(f.config,r,port),/SIDECAR_BRANCH_CONFLICT/);
  assert.equal(writes,1);
});
