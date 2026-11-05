import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as sidecar from '../scripts/github-user-sidecar.mjs';
import { operationArguments } from '../scripts/github-sidecar/launcher.mjs';

const SHA='b'.repeat(40), OTHER='c'.repeat(40);
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'github-pr-tools-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config={schemaVersion:1,installationId:'ff00599c-abcd-4b33-9111-00ee66aa44bb',
    root,userSid:'S-1-5-21-11-22-33-1001',expectedGitHubLogin:'operator',
    taskName:'HashiHubV2-GitHubRead-test',taskPath:'\\',userProfile:root,
    ghPath:process.execPath,gitPath:process.execPath,workerPath:join(root,'worker.mjs'),
    workerSHA256:'a'.repeat(64),repositories:['example/one'],writeRepositories:['example/one']};
  for(const name of ['queue','responses','sources','hooks','uploads','requests','claims','work']) mkdirSync(join(root,name));
  const current={repository:'example/one',number:4,sha:SHA,head:'feature/update',base:'main',
    state:'open',merged:false,draft:false,title:'Original title',body:'Original body\n',
    updatedAt:'2026-10-31T01:00:00Z',url:'https://github.com/example/one/pull/4',changedFiles:0,comments:0};
  const f={root,config,current,mutations:0};
  f.port={
    detail:()=>structuredClone(current),
    edit:(_r,changes)=>{f.mutations++;Object.assign(current,changes,{updatedAt:'2026-10-31T02:00:00Z'});return structuredClone(current);},
    filesPage:()=>[],commentsPage:()=>[],
    createComment:r=>{f.mutations++;f.comment={id:12,body:r.body,author:'operator',url:'https://github.com/example/one/pull/4#issuecomment-12'};return structuredClone(f.comment);},
    comment:()=>structuredClone(f.comment)
  };
  return f;
}
function request(f,operation,extra={}) {
  return {schemaVersion:1,installationId:f.config.installationId,id:randomUUID(),
    issuedAt:Date.now(),expiresAt:Date.now()+120000,operation,repo:'example/one',pr:4,...extra};
}
function view(f){return sidecar.executeRead(f.config,request(f,'pr-view'),f.port);}
function editRequest(f,extra={}){return request(f,'pr-edit',{sha:SHA,revision:view(f).revision,body:'Updated body\n',...extra});}
function edit(f,r){return sidecar.executeWrite(f.config,r,{pr:f.port});}

test('PR CLI accepts details, bounded files/comments and pinned metadata writes; rejects overrides',()=>{
  for(const op of ['pr-view','pr-files','pr-comments']) assert.equal(operationArguments([op,'--repo','example/one','--pr','4']).command,op);
  assert.equal(operationArguments(['pr-edit','--repo','example/one','--pr','4','--sha',SHA,'--expected-revision','a'.repeat(64),'--body-file',join(tmpdir(),'正文.md')]).command,'pr-edit');
  assert.equal(operationArguments(['pr-comment','--repo','example/one','--pr','4','--sha',SHA,'--body-file',join(tmpdir(),'comment.md')]).command,'pr-comment');
  for(const args of [
    ['pr-edit','--repo','example/one','--pr','4','--sha',SHA,'--body-file','x'],
    ['pr-edit','--repo','example/one','--pr','4','--sha',SHA,'--expected-revision','a'.repeat(64)],
    ['pr-view','--repo','example/one','--pr','0'],
    ['pr-files','--repo','example/one','--pr','4','--limit','101'],
    ['pr-comment','--repo','example/one','--pr','4','--sha',SHA,'--body-file','x','--command','whoami'],
    ['pr-view','--repo','example/one','--pr','4','--repo','foreign/private']
  ]) assert.throws(()=>operationArguments(args),/ARGUMENT_REJECTED/);
});

test('PR detail returns full body and a metadata revision',t=>{
  const f=fixture(t),first=view(f);assert.equal(first.body,f.current.body);assert.equal(first.sha,SHA);assert.match(first.revision,/^[a-f0-9]{64}$/);
  f.current.body='Other writer';assert.notEqual(view(f).revision,first.revision);assert.equal(f.mutations,0);
});

test('body editing preserves literal Unicode and newlines without changing title, state or head',t=>{
  const f=fixture(t),body='# 修复\nLiteral $(whoami) "quotes"\n'+String.fromCharCode(96)+'code'+String.fromCharCode(96)+'\n';
  const result=edit(f,editRequest(f,{body}));assert.equal(result.body,body);assert.equal(f.current.title,'Original title');
  assert.equal(f.current.state,'open');assert.equal(f.current.sha,SHA);assert.equal(f.mutations,1);assert.equal(result.verified,true);assert.equal(result.reused,false);
});

test('title-only editing and explicit empty body are supported',t=>{
  const f=fixture(t),r=editRequest(f,{title:'Precise title'});delete r.body;edit(f,r);
  assert.equal(f.current.title,'Precise title');assert.equal(f.current.body,'Original body\n');
  edit(f,editRequest(f,{body:''}));assert.equal(f.current.body,'');
});

test('read-only repository scope still reads but cannot edit or comment',t=>{
  const f=fixture(t),r=editRequest(f);f.config.writeRepositories=[];assert.equal(view(f).number,4);
  assert.throws(()=>edit(f,r),/SIDECAR_WRITE_SCOPE_REJECTED/);
  assert.throws(()=>sidecar.executeWrite(f.config,request(f,'pr-comment',{sha:SHA,body:'No scope'}),{pr:f.port}),/SIDECAR_WRITE_SCOPE_REJECTED/);assert.equal(f.mutations,0);
});

test('invalid targets, UTF8 size and unsupported mutation fields stop before IO',t=>{
  const f=fixture(t),r=editRequest(f);
  for(const change of [{repo:'foreign/private'},{pr:0},{revision:'invalid'},{body:'春'.repeat(30000)},
    {title:'   '},{body:'x\0y'},{body:undefined,title:undefined},{state:'closed'},{command:'whoami'}])
    assert.throws(()=>edit(f,{...r,...change}),/SIDECAR_(REQUEST_REJECTED|WRITE_SCOPE_REJECTED)/);
  assert.equal(f.mutations,0);
});

test('a stale HEAD or body revision cannot overwrite another writer',t=>{
  const f=fixture(t),r=editRequest(f);f.current.body='Other text';
  assert.throws(()=>edit(f,r),/SIDECAR_PULL_REQUEST_CONFLICT/);f.current.sha=OTHER;
  assert.throws(()=>edit(f,r),/SIDECAR_PULL_REQUEST_CONFLICT/);assert.equal(f.mutations,0);assert.equal(f.current.body,'Other text');
});

test('metadata is checked again immediately before mutation',t=>{
  const f=fixture(t),r=editRequest(f);let reads=0;const original=f.port.detail;
  f.port.detail=()=>{if(++reads===2) f.current.title='Another writer';return original();};
  assert.throws(()=>edit(f,r),/SIDECAR_PULL_REQUEST_CONFLICT/);assert.equal(f.mutations,0);
});

test('already matching requested fields return a verified no-op',t=>{
  const f=fixture(t),r=editRequest(f);edit(f,r);assert.equal(edit(f,r).reused,true);assert.equal(f.mutations,1);
});

test('lost edit response reconciles the exact result without replay',t=>{
  const f=fixture(t),r=editRequest(f),original=f.port.edit;
  f.port.edit=(...args)=>{original(...args);throw new Error('PRIVATE provider details');};
  const result=edit(f,r);assert.equal(result.reconciled,true);assert.equal(result.verified,true);assert.equal(f.mutations,1);
});

test('unavailable readback stays uncertain instead of reporting success',t=>{
  const f=fixture(t),r=editRequest(f);let reads=0;const original=f.port.detail;
  f.port.detail=()=>{if(++reads>=3) throw new Error('PRIVATE details');return original();};
  assert.throws(()=>edit(f,r),/SIDECAR_WRITE_OUTCOME_UNCERTAIN/);assert.equal(f.mutations,1);
});

test('files paginate and expose incomplete coverage and missing patches',t=>{
  const f=fixture(t);f.current.changedFiles=45;
  const files=Array.from({length:45},(_,i)=>({filename:'src/f'+i,status:'modified',additions:1,deletions:0,patch:i===0?null:'@@'}));
  f.port.filesPage=(_repo,_pr,page,size)=>files.slice((page-1)*size,page*size);
  const result=sidecar.executeRead(f.config,request(f,'pr-files',{sha:SHA,limit:25}),f.port);
  assert.equal(result.files.length,25);assert.equal(result.complete,false);assert.equal(result.patches_complete,false);assert.equal(result.omitted,20);
});

test('comment bodies and coverage are explicitly bounded',t=>{
  const f=fixture(t);f.current.comments=25;
  const comments=Array.from({length:25},(_,i)=>({id:i+1,body:i===0?'x'.repeat(9000):'Comment',author:'operator',url:'https://github.com/example/one/pull/4#issuecomment-'+(i+1)}));
  f.port.commentsPage=(_repo,_pr,page,size)=>comments.slice((page-1)*size,page*size);
  const result=sidecar.executeRead(f.config,request(f,'pr-comments',{limit:15}),f.port);
  assert.equal(result.comments.length,15);assert.equal(result.complete,false);assert.equal(result.comments[0].body.length,8192);assert.equal(result.comments[0].body_truncated,true);
});

test('HEAD changes during a paged read cannot mix snapshots silently',t=>{
  const f=fixture(t);f.current.changedFiles=1;
  f.port.filesPage=()=>{f.current.sha=OTHER;return [{filename:'a',status:'modified',additions:1,deletions:0,patch:'@@'}];};
  assert.throws(()=>sidecar.executeRead(f.config,request(f,'pr-files',{sha:SHA}),f.port),/SIDECAR_PULL_REQUEST_CONFLICT/);
});

test('foreign PR detail or returned comment target cannot be accepted',t=>{
  const f=fixture(t);f.current.repository='foreign/private';assert.throws(()=>view(f),/SIDECAR_(UPSTREAM_RESPONSE_REJECTED|PULL_REQUEST_CONFLICT)/);
  f.current.repository='example/one';const original=f.port.createComment;
  f.port.createComment=r=>({...original(r),url:'https://github.com/foreign/private/pull/4#issuecomment-12'});
  assert.throws(()=>sidecar.executeWrite(f.config,request(f,'pr-comment',{sha:SHA,body:'Fixture'}),{pr:f.port}),/SIDECAR_WRITE_OUTCOME_UNCERTAIN/);
});

test('comment writes persist one effect across result lookup and a repeated request ID',async t=>{
  const f=fixture(t),payload={operation:'pr-comment',repo:'example/one',pr:4,sha:SHA,body:'Literal fixture'};
  const r=sidecar.enqueue(f.config,payload);assert.equal(existsSync(join(f.root,'requests',r.id+'.json')),true);
  const options={observedSid:f.config.userSid,execute:req=>sidecar.executeWrite(f.config,req,{pr:f.port})};
  await sidecar.processPending(f.config,options);assert.equal(sidecar.readReply(f.config,r).data.comment.id,12);assert.equal(f.mutations,1);
  assert.deepEqual(sidecar.enqueue(f.config,payload,{id:r.id}),r);await sidecar.processPending(f.config,options);assert.equal(f.mutations,1);
  assert.throws(()=>sidecar.enqueue(f.config,{...payload,body:'Changed'},{id:r.id}),/SIDECAR_REQUEST_ID_REUSED/);
});

test('an interrupted comment claim never replays',async t=>{
  const f=fixture(t),r=sidecar.enqueue(f.config,{operation:'pr-comment',repo:'example/one',pr:4,sha:SHA,body:'Fixture'});
  writeFileSync(join(f.root,'claims',r.id+'.json'),'{}');
  await sidecar.processPending(f.config,{observedSid:f.config.userSid,execute:()=>assert.fail('No replay')});
  assert.equal(sidecar.readReply(f.config,r).error.code,'SIDECAR_WRITE_OUTCOME_UNCERTAIN');assert.equal(f.mutations,0);
});

test('inherited account scope stays bound to the configured login',t=>{
  const f=fixture(t),c={...f.config,repositoryScope:'account',writeRepositoryScope:'account',repositories:[],writeRepositories:[]};
  sidecar.validateConfig(c);assert.equal(sidecar.repositoryAllowed(c,'operator/new-private',{write:true}),true);
  assert.equal(sidecar.repositoryAllowed(c,'foreign/private',{write:true}),false);
});

test('text files are read literally with BOM handling and bounded strict UTF8',t=>{
  const f=fixture(t),path=join(f.root,'body.md'),body='# 正文\n$(whoami)\n';
  writeFileSync(path,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(body)]));
  assert.equal(sidecar.readTextInput(path),body);
  writeFileSync(path,Buffer.from([0xff,0xff]));
  assert.throws(()=>sidecar.readTextInput(path),/SIDECAR_TEXT_INPUT_REJECTED/);
  writeFileSync(path,Buffer.alloc(65537));
  assert.throws(()=>sidecar.readTextInput(path),/SIDECAR_SIZE_REJECTED/);
  assert.throws(()=>sidecar.readTextInput('relative.md'),/SIDECAR_TEXT_INPUT_REJECTED/);
  assert.throws(()=>sidecar.readTextInput(f.root),/SIDECAR_TEXT_INPUT_REJECTED/);
});

test('provider failures persist only fixed diagnostic fields, never raw error text',async t=>{
  const f=fixture(t),r=sidecar.enqueue(f.config,{operation:'pr-comment',repo:'example/one',pr:4,sha:SHA,body:'Fixture'});
  await sidecar.processPending(f.config,{observedSid:f.config.userSid,execute:()=>{
    throw Object.assign(new Error('PRIVATE_SECRET_PROVIDER_TEXT'),{code:'SIDECAR_UPSTREAM_FAILED',
      httpStatus:403,apiMethod:'POST',apiResource:'pull_request_comments',upstreamReason:'PERMISSION_DENIED'});
  }});
  const reply=sidecar.readReply(f.config,r);
  assert.equal(reply.ok,false);assert.equal(reply.error.httpStatus,403);
  assert.equal(reply.error.apiResource,'pull_request_comments');
  assert.equal(JSON.stringify(reply).includes('PRIVATE_SECRET_PROVIDER_TEXT'),false);
});

test('installed retarget and operation discovery remain available alongside PR editing',t=>{
  const f=fixture(t),pull={...f.current,base:'release'};
  const r=request(f,'pr-update-base',{sha:SHA,currentBaseBranch:'release',baseBranch:'main'});
  const result=sidecar.executeWrite(f.config,r,{
    repository:()=>({defaultBranch:'main'}),pull:()=>structuredClone(pull),
    updatePull:()=>{f.mutations++;pull.base='main';return structuredClone(pull);}
  });
  assert.equal(result.updated,true);assert.equal(result.base,'main');assert.equal(f.mutations,1);
  for(const name of ['account','main','checks','source','branch','pr-list','merge-info',
    'push','write','pr-create','pr-merge','pr-update-base','result','pr-view','pr-edit',
    'pr-files','pr-comments','pr-comment']) assert.equal(sidecar.supportedOperations().includes(name),true);
});
