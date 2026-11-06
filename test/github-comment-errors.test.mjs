import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sidecar from '../scripts/github-user-sidecar.mjs';

const SHA='b'.repeat(40), PRIVATE='PRIVATE_PROVIDER_TEXT_TOKEN_AND_PATH';
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'github-comment-errors-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config={schemaVersion:1,installationId:'ff00599c-abcd-4b33-9111-00ee66aa44bb',
    root,userSid:'S-1-5-21-11-22-33-1001',expectedGitHubLogin:'operator',
    taskName:'HashiHubV2-GitHubRead-test',taskPath:'\\',userProfile:root,
    ghPath:process.execPath,gitPath:process.execPath,workerPath:join(root,'worker.mjs'),
    workerSHA256:'a'.repeat(64),repositories:['example/one'],writeRepositories:['example/one']};
  for(const name of ['queue','responses','sources','hooks','uploads','requests','claims','work']) mkdirSync(join(root,name));
  const pull={repository:'example/one',number:4,sha:SHA,head:'feature/update',base:'main',
    state:'open',merged:false,draft:false,title:'Title',body:'Body',updatedAt:'2026-11-04T01:00:00Z',
    url:'https://github.com/example/one/pull/4',changedFiles:0,comments:0};
  const f={root,config,posts:0,effects:0,commentReads:0};
  f.port={
    detail:()=>structuredClone(pull),
    createComment:r=>{
      f.posts++;f.effects++;
      f.comment={id:12,body:r.body,author:'operator',url:pull.url+'#issuecomment-12'};
      return structuredClone(f.comment);
    },
    comment:()=>{f.commentReads++;return structuredClone(f.comment);}
  };
  return f;
}
function upstream(status,reason='API_REJECTED',method='POST',resource='pull_request_comments') {
  return Object.assign(new Error(PRIVATE),{code:'SIDECAR_UPSTREAM_FAILED',httpStatus:status,
    upstreamReason:reason,apiMethod:method,apiResource:resource,exitCode:1,
    stderr:PRIVATE,response:{message:PRIVATE}});
}
async function runComment(f) {
  const payload={operation:'pr-comment',repo:'example/one',pr:4,sha:SHA,body:'One explicitly requested comment'};
  const request=sidecar.enqueue(f.config,payload);
  const worker={observedSid:f.config.userSid,execute:r=>sidecar.executeWrite(f.config,r,{pr:f.port})};
  await sidecar.processPending(f.config,worker);
  return {payload,request,worker,reply:sidecar.readReply(f.config,request)};
}
async function assertDurableNoReplay(f,run) {
  const reopened=JSON.parse(JSON.stringify(f.config));
  assert.equal(existsSync(join(f.root,'claims',run.request.id+'.json')),true);
  assert.deepEqual(sidecar.requestResult(reopened,run.request.id),run.reply);
  assert.deepEqual(sidecar.enqueue(reopened,run.payload,{id:run.request.id}),run.request);
  await sidecar.processPending(reopened,run.worker);
  // Even a duplicate queue delivery cannot bypass an existing result/claim.
  writeFileSync(join(f.root,'queue',run.request.id+'.json'),JSON.stringify(run.request));
  await sidecar.processPending(reopened,run.worker);
  assert.deepEqual(sidecar.requestResult(reopened,run.request.id),run.reply);
  assert.throws(()=>sidecar.enqueue(reopened,{...run.payload,body:'Different input'},{id:run.request.id}),
    /SIDECAR_REQUEST_ID_REUSED/);
  assert.equal(f.posts,1);
  assert.equal(JSON.stringify(run.reply).includes(PRIVATE),false);
}

for(const [status,reason] of [
  [400,'API_REJECTED'],[401,'AUTHENTICATION_REQUIRED'],[403,'PERMISSION_DENIED'],
  [404,'NOT_FOUND'],[409,'API_REJECTED'],[422,'VALIDATION_REJECTED'],[429,'RATE_LIMITED']
]) test('comment POST HTTP '+status+' retains safe rejection diagnostics durably',async t=>{
  const f=fixture(t);
  f.port.createComment=()=>{f.posts++;throw upstream(status,reason);};
  const run=await runComment(f);
  assert.equal(run.reply.ok,false);
  assert.deepEqual(run.reply.error,{code:'SIDECAR_UPSTREAM_FAILED',httpStatus:status,
    upstreamReason:reason,apiMethod:'POST',apiResource:'pull_request_comments',exitCode:1});
  assert.equal(f.commentReads,0);assert.equal(f.effects,0);
  await assertDurableNoReplay(f,run);
});

for(const [name,error] of [
  ['HTTP 408',()=>upstream(408)],['HTTP 500',()=>upstream(500)],
  ['HTTP 502',()=>upstream(502)],['HTTP 503',()=>upstream(503)],
  ['process timeout',()=>Object.assign(new Error(PRIVATE),{code:'SIDECAR_COMMAND_TIMEOUT'})],
  ['lost connection',()=>new Error(PRIVATE)]
]) test('ambiguous comment POST '+name+' never replays a possibly applied append',async t=>{
  const f=fixture(t),create=f.port.createComment;
  f.port.createComment=r=>{create(r);throw error();};
  const run=await runComment(f);
  assert.equal(run.reply.ok,false);
  assert.deepEqual(run.reply.error,{code:'SIDECAR_WRITE_OUTCOME_UNCERTAIN'});
  assert.equal(f.commentReads,0);assert.equal(f.effects,1);
  await assertDurableNoReplay(f,run);assert.equal(f.effects,1);
});

for(const [name,change] of [
  ['comment GET 403',f=>{f.port.comment=()=>{throw upstream(403,'PERMISSION_DENIED','GET');};}],
  ['PR GET 404',f=>{
    const detail=f.port.detail;
    f.port.detail=()=>{if(f.effects) throw upstream(404,'NOT_FOUND','GET','pull_request');return detail();};
  }],
  ['malformed POST response',f=>{
    const create=f.port.createComment;
    f.port.createComment=r=>{create(r);return null;};
  }],
  ['different readback body',f=>{
    const comment=f.port.comment;f.port.comment=()=>({...comment(),body:'Another body'});
  }],
  ['foreign readback author',f=>{
    const comment=f.port.comment;f.port.comment=()=>({...comment(),author:'another-user'});
  }],
  ['changed PR HEAD',f=>{
    const detail=f.port.detail;f.port.detail=()=>({...detail(),...(f.effects?{sha:'c'.repeat(40)}:{})});
  }]
]) test('successful comment POST followed by '+name+' stays uncertain and claimed',async t=>{
  const f=fixture(t);change(f);
  const run=await runComment(f);
  assert.equal(run.reply.ok,false);
  assert.deepEqual(run.reply.error,{code:'SIDECAR_WRITE_OUTCOME_UNCERTAIN'});
  assert.equal(f.effects,1);
  await assertDurableNoReplay(f,run);assert.equal(f.effects,1);
});
