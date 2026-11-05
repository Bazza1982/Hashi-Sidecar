import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as sidecar from '../scripts/github-user-sidecar.mjs';
import { operationArguments } from '../scripts/github-sidecar/launcher.mjs';

const SHA='b'.repeat(40), JOB=124447044228;
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'github-check-log-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const name of ['queue','responses','sources','hooks','uploads','requests','claims','work']) mkdirSync(join(root,name));
  const c={schemaVersion:1,installationId:randomUUID(),root,userSid:'S-1-5-21-11-22-33-1001',
    expectedGitHubLogin:'operator',taskName:'HashiHubV2-GitHubRead-test',taskPath:'\\',userProfile:root,
    ghPath:process.execPath,gitPath:process.execPath,workerPath:join(root,'worker.mjs'),workerSHA256:'a'.repeat(64),
    repositories:['example/one'],writeRepositories:[]};
  const r={schemaVersion:1,installationId:c.installationId,id:randomUUID(),issuedAt:Date.now(),
    expiresAt:Date.now()+120000,operation:'check-log',repo:'example/one',sha:SHA,job:JOB};
  const job={id:JOB,runId:12,sha:SHA,status:'completed',conclusion:'failure',name:'Windows CI',
    url:'https://github.com/example/one/actions/runs/12/job/'+JOB,
    steps:[{name:'Install',status:'completed',conclusion:'failure',number:3}]};
  let logs=0;
  return {c,r,job,port:{job:()=>structuredClone(job),log:()=>{logs++;return 'npm failed\n';}},get logs(){return logs;}};
}
test('CI log CLI requires an exact SHA and a positive safe job ID with no arbitrary command',()=>{
  const cli=operationArguments(['check-log','--repo','example/one','--sha',SHA,'--job',String(JOB)]);
  assert.equal(cli.command,'check-log');assert.equal(sidecar.parseArgs(cli.argv).job,String(JOB));
  for(const args of [
    ['check-log','--repo','example/one','--job',String(JOB)],
    ...['0','1.2','9007199254740992'].map(job=>['check-log','--repo','example/one','--sha',SHA,'--job',job]),
    ['check-log','--repo','example/one','--sha',SHA,'--job',String(JOB),'--url','https://other']
  ]) assert.throws(()=>operationArguments(args),/ARGUMENT_REJECTED/);
});
test('CI log is read-only and returns the exact job, failed steps and bounded output',t=>{
  const f=fixture(t),result=sidecar.executeRead(f.c,f.r,f.port);
  assert.equal(result.job,f.r.job);assert.equal(result.sha,SHA);assert.equal(result.log,'npm failed\n');
  assert.equal(result.steps[0].conclusion,'failure');assert.equal(result.truncated,false);assert.equal(f.logs,1);
});
test('foreign repository, wrong SHA/job and noncompleted job never fetch a log',t=>{
  const f=fixture(t);
  for(const change of [{sha:'c'.repeat(40)},{id:JOB+1},{url:'https://github.com/foreign/private/actions/runs/12/job/'+JOB},
    {status:'in_progress'}]) {
    const port={...f.port,job:()=>({...f.job,...change})};
    assert.throws(()=>sidecar.executeRead(f.c,f.r,port),/SIDECAR_(CHECK_JOB_CONFLICT|UPSTREAM_RESPONSE_REJECTED)/);
  }
  assert.throws(()=>sidecar.executeRead(f.c,{...f.r,repo:'foreign/private'},f.port),/SIDECAR_REQUEST_REJECTED/);
  assert.equal(f.logs,0);
});
test('CI log tail has a strict UTF8 byte bound and masks recognised credential formats',t=>{
  const f=fixture(t),token='github_pat_'+'a'.repeat(60);
  f.port.log=()=>('春'.repeat(60000)+'\nAuthorization: Bearer hidden-value\n'+token+'\nLAST_FAILURE');
  const result=sidecar.executeRead(f.c,f.r,f.port);
  assert.equal(result.truncated,true);assert.equal(result.reason,'tail_byte_limit');
  assert.ok(Buffer.byteLength(result.log)<=131072);assert.equal(result.log.includes('\ufffd'),false);
  assert.equal(result.log.includes('hidden-value'),false);assert.equal(result.log.includes(token),false);
  assert.ok(result.log.endsWith('LAST_FAILURE'));
});
test('a changed job after log retrieval is rejected rather than silently misattributed',t=>{
  const f=fixture(t);let reads=0;
  f.port.job=()=>({...f.job,sha:++reads===1?SHA:'c'.repeat(40)});
  assert.throws(()=>sidecar.executeRead(f.c,f.r,f.port),/SIDECAR_CHECK_JOB_CONFLICT/);
});
