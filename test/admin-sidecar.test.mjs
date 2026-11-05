import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {authorize,validateOperation,enqueue,processQueue,resultFor,revokeGrant,redact,githubEndpoint} from '../scripts/admin-sidecar/core.mjs';
const system='S-1-5-18',user='S-1-5-21-1-2-3-1001';
const identity={sid:system,elevated:true,system:true,machine:'fixture'};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'admin-sidecar-'));
 const c={schemaVersion:2,installationId:randomUUID(),root,machine:'fixture',userSid:user,
 publisherSids:[system],issuerSids:[system],expectedGitHubLogin:'operator',profiles:{
 system:{sid:system,elevated:true},user:{sid:user,elevated:false},'user-admin':{sid:user,elevated:true}}};
 for(const p of ['grants','revoked','requests','events',...['system','user','user-admin'].flatMap(x=>['queue','claims','responses','cancel','work'].map(y=>'lanes/'+x+'/'+y))])mkdirSync(join(root,p),{recursive:true});
 const g={schemaVersion:2,id:randomUUID(),installationId:c.installationId,machine:c.machine,callerSids:[system],
 profiles:['system','user','user-admin'],capabilities:['identity','process','script','file','github','service','registry','task'],
 allowAnyCode:true,issuedAt:Date.now()-1000,expiresAt:Date.now()+60000,task:'fixture',issuedBy:system};
 writeFileSync(join(root,'grants',g.id+'.json'),JSON.stringify(g));
 const codec={protect:s=>Buffer.from(s).toString('base64'),unprotect:s=>Buffer.from(s,'base64').toString()};
 return {c,g,codec,request:{id:randomUUID(),grantId:g.id,profile:'system',operation:'identity',input:{}}};
}
test('administration grant binds installation, host, actual publisher, capability and identity lane',()=>{
 const {c,g,request}=fixture();assert.equal(authorize(c,g,request,identity).id,g.id);
 for(const edit of [{machine:'foreign'},{installationId:randomUUID()},{expiresAt:0},{profiles:['user']},{capabilities:['github']},{callerSids:[user]}])
 assert.throws(()=>authorize(c,{...g,...edit},request,identity));
 assert.throws(()=>authorize(c,g,request,{...identity,sid:user,system:false,elevated:false}));
});
test('an ordinary user cannot publish privileged immutable intents or issue grants',()=>{
 const {c,g,request,codec}=fixture();assert.throws(()=>enqueue(c,request,{identity:{sid:user,elevated:false,machine:'fixture'},codec}));
});
test('operation schema rejects command injection fields, unsupported profiles, relative paths and excessive runtimes',()=>{
 const p={operation:'process.run',input:{executable:join(tmpdir(),'tool.exe'),args:['literal & $x'],cwd:tmpdir(),timeoutMs:1000}};
 assert.equal(validateOperation(p).operation,'process.run');
 for(const input of [{...p.input,command:'whoami'},{...p.input,executable:'relative.exe'},{...p.input,timeoutMs:90000001},{...p.input,env:{GH_TOKEN:'secret'}}])
 assert.throws(()=>validateOperation({...p,input}));
 assert.throws(()=>validateOperation({operation:'unknown',input:{}}));
});
test('GitHub endpoint is relative, canonical and fixed to the installed GitHub host',()=>{
 assert.equal(githubEndpoint('/repos/operator/repo/issues?state=open'),'repos/operator/repo/issues?state=open');
 for(const x of ['https://evil.invalid/user','//evil.invalid/user','/../user','/repos/%2e%2e/user','/user#fragment','/user\\x'])
 assert.throws(()=>githubEndpoint(x));
});
test('broad code execution requires an explicit full-code grant',()=>{
 const {c,g,request}=fixture();const r={...request,operation:'process.run',input:{executable:join(tmpdir(),'tool.exe'),args:[],cwd:tmpdir()}};
 assert.throws(()=>authorize(c,{...g,allowAnyCode:false},r,identity));
 assert.equal(authorize(c,g,r,identity).id,g.id);
});
test('durable intent is encrypted, a result reopens and duplicate queue delivery does not replay effects',async()=>{
 const {c,g,request,codec}=fixture();const r={...request,operation:'process.run',input:{executable:join(tmpdir(),'tool.exe'),args:['secret-input'],cwd:tmpdir()}};
 const env=enqueue(c,r,{identity,codec});assert.ok(!readFileSync(join(c.root,'requests',r.id+'.json'),'utf8').includes('secret-input'));
 let count=0;const execute=async()=>{count++;return {exitCode:0,stdout:'ok'}};
 await processQueue(c,'system',{identity,codec,execute});assert.equal(count,1);
 assert.equal(resultFor(c,r.id).ok,true);assert.equal(resultFor(c,r.id).data.stdout,'ok');
 enqueue(c,r,{identity,codec});await processQueue(c,'system',{identity,codec,execute});assert.equal(count,1);
 writeFileSync(join(c.root,'lanes/system/queue',r.id+'.json'),JSON.stringify({id:r.id}));
 await processQueue(c,'system',{identity,codec,execute});assert.equal(count,1);
 assert.throws(()=>enqueue(c,{...r,input:{...r.input,args:['changed']}},{identity,codec}));
 assert.equal(env.id,r.id);
});
test('expired or revoked grants prevent execution even after a request is queued',async()=>{
 const {c,g,request,codec}=fixture();enqueue(c,request,{identity,codec});revokeGrant(c,g.id,identity);let count=0;
 await processQueue(c,'system',{identity,codec,execute:async()=>{count++;return {}}});assert.equal(count,0);assert.equal(resultFor(c,request.id).ok,false);
});
test('a wrong execution SID or missing elevation cannot claim a pending administration request',async()=>{
 const {c,request,codec}=fixture();enqueue(c,request,{identity,codec});let count=0;
 await assert.rejects(()=>processQueue(c,'system',{identity:{...identity,sid:user,system:false,elevated:false},codec,execute:async()=>{count++;return {}}}));
 assert.equal(count,0);assert.ok(existsSync(join(c.root,'lanes/system/queue',request.id+'.json')));
});
test('a claimed uncertain operation is never automatically repeated',async()=>{
 const {c,request,codec}=fixture();enqueue(c,request,{identity,codec});writeFileSync(join(c.root,'lanes/system/claims',request.id+'.json'),'{}');
 let count=0;await processQueue(c,'system',{identity,codec,execute:async()=>{count++;return {}}});assert.equal(count,0);
 assert.equal(resultFor(c,request.id).error.code,'ADMIN_OUTCOME_UNCERTAIN');
});
test('observed rejection diagnostics survive but raw secrets are omitted from errors',async()=>{
 const {c,request,codec}=fixture();enqueue(c,request,{identity,codec});
 await processQueue(c,'system',{identity,codec,execute:async()=>{throw Object.assign(new Error('password=private'),{code:'ADMIN_UPSTREAM_REJECTED',httpStatus:403,reason:'PERMISSION_DENIED'});}});
 const r=resultFor(c,request.id);assert.equal(r.error.httpStatus,403);assert.ok(!JSON.stringify(r).includes('private'));
});
test('sensitive fields and known credential formats are redacted recursively',()=>{
 const x=redact({password:'private',nested:{Authorization:'Bearer private',value:'github_pat_'+'a'.repeat(50)},stdout:'token='+ 'ghp_'+'a'.repeat(40)});
 assert.equal(x.password,'[REDACTED]');assert.ok(!JSON.stringify(x).includes('private'));assert.ok(!JSON.stringify(x).includes('ghp_'));
});
test('script input is snapshot-pinned and CAS file writes require an expected state',()=>{
 const source='Write-Output literal',sha=createHash('sha256').update(source).digest('hex');
 assert.equal(validateOperation({operation:'script.run',input:{interpreter:'powershell',script:source,sha256:sha,args:[],cwd:tmpdir()}}).operation,'script.run');
 assert.throws(()=>validateOperation({operation:'script.run',input:{interpreter:'powershell',script:source,sha256:'0'.repeat(64),args:[],cwd:tmpdir()}}));
 assert.throws(()=>validateOperation({operation:'file.write',input:{path:join(tmpdir(),'x'),content:'text'}}));
 assert.equal(validateOperation({operation:'file.write',input:{path:join(tmpdir(),'x'),content:'text',expectedSha256:null}}).operation,'file.write');
});
