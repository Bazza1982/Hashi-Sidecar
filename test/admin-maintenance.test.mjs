import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {authorize,createGrant,enqueue,processQueue,resultFor,validateOperation} from '../scripts/admin-sidecar/core.mjs';
const system='S-1-5-18',user='S-1-5-21-1-2-3-1001';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'admin-maintenance-'));
 const c={schemaVersion:2,installationId:randomUUID(),root,machine:'fixture',userSid:user,publisherSids:[system],issuerSids:[system],
 profiles:{system:{sid:system,elevated:true},user:{sid:user,elevated:false},'user-admin':{sid:user,elevated:true}}};
 for(const p of ['grants','revoked','requests','maintenance/plans','lanes/user/queue'])mkdirSync(join(root,p),{recursive:true});
 const who={sid:system,system:true,elevated:true,machine:'fixture'};
 return {c,who};
}
test('typed ACL maintenance has a task grant without arbitrary-code permission',()=>{
 const {c,who}=fixture(),g=createGrant(c,{task:'repair owned credential access',profiles:['system','user'],capabilities:['acl','file'],
 callerSids:[system],durationSeconds:300,allowAnyCode:false,pathRoots:[tmpdir()]},who);
 const r={grantId:g.id,profile:'system',operation:'acl.plan',input:{path:join(tmpdir(),'credential'),changes:[{action:'grant',sid:user,rights:'Read'}]}};
 assert.equal(authorize(c,g,r,who).id,g.id);
 assert.throws(()=>authorize(c,{...g,pathRoots:[join(tmpdir(),'different')]},r,who),{code:'ADMIN_RESOURCE_REJECTED'});
});
test('ACL apply and restore require the original plan and expected path',()=>{
 const p={operation:'acl.apply',input:{path:join(tmpdir(),'credential'),planId:randomUUID()}};
 assert.equal(validateOperation(p).operation,'acl.apply');
 assert.throws(()=>validateOperation({...p,input:{...p.input,path:'relative'}}));
 assert.throws(()=>validateOperation({...p,input:{...p.input,planId:'../escape'}}));
 assert.throws(()=>validateOperation({operation:'acl.plan',input:{path:join(tmpdir(),'x'),changes:[{action:'grant',sid:'Everyone',rights:'FullControl'}]}}));
});
test('ordinary-user execution rejects an elevated token even when the SID matches',async()=>{
 const {c}=fixture();
 await assert.rejects(()=>processQueue(c,'user',{identity:{sid:user,elevated:true,machine:'fixture'},execute:()=>{}}),{code:'ADMIN_EXECUTION_IDENTITY_REJECTED'});
});
test('long approved operations are admitted and remain bounded',()=>{
 const r={operation:'process.run',input:{executable:join(tmpdir(),'tool.exe'),args:[],cwd:tmpdir(),timeoutMs:3600000}};
 assert.equal(validateOperation(r).operation,'process.run');
 assert.throws(()=>validateOperation({...r,input:{...r.input,timeoutMs:90000001}}));
});
test('process stop requires PID-reuse guards and task restart preserves exact target selection',()=>{
 const r={operation:'process.stop',input:{pid:4321,expectedCreationTicks:'638000000000000000',expectedExecutable:join(tmpdir(),'tool.exe'),timeoutMs:5000}};
 assert.equal(validateOperation(r).operation,'process.stop');
 assert.throws(()=>validateOperation({...r,input:{pid:4321}}));
 assert.equal(validateOperation({operation:'task.restart',input:{name:'OwnedFixture',folder:'\\',expectedState:'Running',timeoutMs:5000}}).operation,'task.restart');
});
test('resource-limited grants reject malformed roots and preserve existing unrestricted operator grants',()=>{
 const {c,who}=fixture();
 const g=createGrant(c,{task:'operator',profiles:['system'],capabilities:['file'],callerSids:[system],durationSeconds:300},who);
 assert.equal(authorize(c,g,{grantId:g.id,profile:'system',operation:'file.probe',input:{path:join(tmpdir(),'owned')}},who).id,g.id);
 assert.throws(()=>createGrant(c,{task:'bad',profiles:['system'],capabilities:['acl'],callerSids:[system],durationSeconds:300,pathRoots:['relative']},who));
});

test('queued long work retains admission until its task grant deadline',async()=>{
 const {c,who}=fixture(),now=Date.now();
 for(const part of ['queue','claims','responses','cancel','work'])mkdirSync(join(c.root,'lanes/system',part),{recursive:true});
 const g=createGrant(c,{task:'long queued work',profiles:['system'],capabilities:['identity'],callerSids:[system],durationSeconds:3600},who);
 const r={id:randomUUID(),grantId:g.id,profile:'system',operation:'identity',input:{}};
 const codec={protect:s=>Buffer.from(s).toString('base64'),unprotect:s=>Buffer.from(s,'base64').toString()};
 const env=enqueue(c,r,{identity:who,codec,now});assert.equal(env.dispatchExpiresAt,g.expiresAt);
 let calls=0;await processQueue(c,'system',{identity:who,codec,now:()=>now+121000,execute:async()=>{calls++;return {ok:true}}});
 assert.equal(calls,1);assert.equal(resultFor(c,r.id).ok,true);
});

test('visible program windows require a real user profile rather than session-zero SYSTEM',()=>{
 const r={profile:'user',operation:'process.run',input:{executable:join(tmpdir(),'app.exe'),args:[],cwd:tmpdir(),window:'normal'}};
 assert.equal(validateOperation(r).profile,'user');assert.equal(validateOperation({...r,profile:'user-admin'}).profile,'user-admin');
 assert.throws(()=>validateOperation({...r,profile:'system'}),{code:'ADMIN_PROFILE_REJECTED'});
 assert.throws(()=>validateOperation({...r,input:{...r.input,window:'unsupported'}}));
});
