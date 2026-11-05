import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueue, executeWrite, processPending, requestResult } from '../scripts/github-user-sidecar.mjs';
import { operationArguments } from '../scripts/github-sidecar/launcher.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'github-merge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { schemaVersion: 1, installationId: 'ff00599c-abcd-4b33-9111-00ee66aa44bb',
    root, userSid: 'S-1-5-21-11-22-33-1001', expectedGitHubLogin: 'operator',
    taskName: 'HashiHubV2-GitHubRead-test', taskPath: '\\', userProfile: root,
    ghPath: process.execPath, gitPath: process.execPath, workerPath: join(root, 'worker.mjs'),
    workerSHA256: 'a'.repeat(64), repositories: ['example/one'], writeRepositories: ['example/one'] };
  for (const name of ['queue','responses','sources','hooks','uploads','requests','claims','work']) mkdirSync(join(root,name));
  const payload = { operation:'pr-merge',repo:'example/one',pr:12,sha:'b'.repeat(40),baseBranch:'main' };
  let pull = { number:12,repository:payload.repo,sha:payload.sha,head:'fix/ready',base:'main',
    state:'open',merged:false,draft:false,mergeable:true,mergeCommit:null,url:'https://github.com/example/one/pull/12' };
  const checks = { repository:payload.repo,sha:payload.sha,complete:true,total:1,
    runs:[{sha:payload.sha,status:'completed',conclusion:'success'}],
    statuses:{state:'pending',total:0,statuses:[]},
    workflows:{total:1,runs:[{sha:payload.sha,status:'completed',conclusion:'success'}]} };
  let mutations = 0;
  const port = {
    pull:() => ({...pull}), checks:() => structuredClone(checks),
    mergePull:r => {
      mutations++; assert.equal(r.sha,payload.sha); assert.equal(r.pr,12);
      pull={...pull,state:'closed',merged:true,mergeCommit:'c'.repeat(40)};
      return {merged:true,sha:pull.mergeCommit};
    }
  };
  return {root,config,payload,port,checks,setPull:p=>{pull={...pull,...p};},mutations:()=>mutations};
}

test('merge CLI requires repository, positive PR number, full approved SHA and base without command overrides', () => {
  const args=['pr-merge','--repo','example/one','--pr','12','--sha','b'.repeat(40),'--base-branch','main'];
  assert.equal(operationArguments(args).command,'pr-merge');
  for (const number of ['0','-1','12/merge','1.5','01','9007199254740992']) {
    const changed=[...args]; changed[4]=number;
    assert.throws(()=>operationArguments(changed),/SHARED_SIDECAR_ARGUMENT_REJECTED/);
  }
  assert.throws(()=>operationArguments(args.slice(0,-2)),/SHARED_SIDECAR_ARGUMENT_REJECTED/);
  assert.throws(()=>operationArguments([...args,'--admin','true']),/SHARED_SIDECAR_ARGUMENT_REJECTED/);
});

test('merging requires write scope and validates its bounded request before external calls', t => {
  const f=fixture(t);
  assert.throws(()=>enqueue({...f.config,writeRepositories:[]},f.payload),/SIDECAR_WRITE_SCOPE_REJECTED/);
  for (const change of [{pr:0},{pr:'12'},{sha:undefined},{baseBranch:undefined},{baseBranch:'../main'},
    {repo:'foreign/private'},{method:'DELETE'},{branch:'main'},{force:true}]) {
    assert.throws(()=>enqueue(f.config,{...f.payload,...change}),/SIDECAR_REQUEST_REJECTED/);
  }
});

test('merge persists one pinned effect and reopens its result without replaying it', async t => {
  const f=fixture(t),r=enqueue(f.config,f.payload);
  await processPending(f.config,{observedSid:f.config.userSid,execute:request=>executeWrite(f.config,request,f.port)});
  const result=requestResult(JSON.parse(JSON.stringify(f.config)),r.id);
  assert.equal(result.ok,true); assert.equal(result.data.merged,true);
  assert.equal(result.data.sha,f.payload.sha); assert.equal(result.data.mergeCommit,'c'.repeat(40));
  assert.equal(f.mutations(),1);
  assert.deepEqual(enqueue(f.config,f.payload,{id:r.id}),r);
  await processPending(f.config,{observedSid:f.config.userSid,execute:()=>assert.fail('replayed merge')});
  assert.equal(f.mutations(),1);
  assert.equal(executeWrite(f.config,r,f.port).reused,true);
  assert.equal(f.mutations(),1);
  assert.equal(JSON.parse(readFileSync(join(f.root,'requests',r.id+'.json'),'utf8')).sha,f.payload.sha);
});

test('changed PR identity, base or head, drafts, closed and conflicted PRs cannot be merged', t => {
  const f=fixture(t),r=enqueue(f.config,f.payload);
  for (const change of [{number:13},{repository:'foreign/private'},{sha:'d'.repeat(40)},{base:'release'},
    {draft:true},{state:'closed',merged:false},{mergeable:false},{mergeable:null}]) {
    assert.throws(()=>executeWrite(f.config,r,{...f.port,pull:()=>({...f.port.pull(),...change})}),
      /SIDECAR_(PULL_REQUEST_CONFLICT|MERGE_NOT_READY)/);
  }
  assert.equal(f.mutations(),0);
});

test('pending, failed, partial or foreign checks block merging, including aggregate status failures', t => {
  const f=fixture(t),r=enqueue(f.config,f.payload);
  const cases=[
    {...f.checks,complete:false},
    {...f.checks,sha:'d'.repeat(40)},
    {...f.checks,repository:'foreign/private'},
    {...f.checks,runs:[],total:0},
    {...f.checks,runs:[{sha:r.sha,status:'in_progress',conclusion:null}]},
    {...f.checks,runs:[{sha:'d'.repeat(40),status:'completed',conclusion:'success'}]},
    {...f.checks,runs:[{sha:r.sha,status:'completed',conclusion:'failure'}]},
    {...f.checks,statuses:{total:1,statuses:[{state:'pending'}]}},
    {...f.checks,workflows:{total:1,runs:[{sha:r.sha,status:'completed',conclusion:'failure'}]}},
    {...f.checks,total:2},
  ];
  for (const checks of cases) assert.throws(()=>executeWrite(f.config,r,{...f.port,checks:()=>checks}),/SIDECAR_MERGE_CHECKS_NOT_READY/);
  assert.equal(f.mutations(),0);
  let reads=0;
  assert.throws(()=>executeWrite(f.config,r,{...f.port,pull:()=>{
    reads++; return {...f.port.pull(),...(reads>1?{sha:'d'.repeat(40)}:{})};
  }}),/SIDECAR_PULL_REQUEST_CONFLICT/);
  assert.equal(f.mutations(),0);
});

test('lost merge response reconciles the same PR and commit; incomplete readback remains uncertain', t => {
  const f=fixture(t),r=enqueue(f.config,f.payload);
  const result=executeWrite(f.config,r,{...f.port,mergePull:request=>{
    f.port.mergePull(request);
    throw Object.assign(new Error('timeout'),{code:'SIDECAR_COMMAND_TIMEOUT'});
  }});
  assert.equal(result.merged,true); assert.equal(result.reconciled,true); assert.equal(f.mutations(),1);
  f.setPull({merged:false,state:'open',mergeCommit:null});
  assert.throws(()=>executeWrite(f.config,r,{...f.port,mergePull:()=>({merged:true,sha:'c'.repeat(40)})}),
    /SIDECAR_WRITE_OUTCOME_UNCERTAIN/);
  f.setPull({merged:true,state:'closed',sha:'d'.repeat(40),mergeCommit:'c'.repeat(40)});
  assert.throws(()=>executeWrite(f.config,r,f.port),/SIDECAR_PULL_REQUEST_CONFLICT/);
});

test('an interrupted claimed merge cannot replay even when its caller restarts', async t => {
  const f=fixture(t),r=enqueue(f.config,f.payload);
  writeFileSync(join(f.root,'claims',r.id+'.json'),JSON.stringify({startedAt:new Date().toISOString()}));
  await processPending(f.config,{observedSid:f.config.userSid,execute:()=>assert.fail('claimed merge repeated')});
  assert.equal(requestResult(f.config,r.id).error.code,'SIDECAR_WRITE_OUTCOME_UNCERTAIN');
});
