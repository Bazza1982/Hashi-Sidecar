import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateConfig,createGrant,enqueue,processQueue,resultFor,authorize} from '../scripts/admin-sidecar/core.mjs';
const system='S-1-5-18', target='S-1-5-21-1-2-3-1001';
const who={sid:system,system:true,elevated:true,machine:'fixture'};
const codec={protect:s=>Buffer.from(s).toString('base64'),unprotect:s=>Buffer.from(s,'base64').toString()};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'standalone-account-'));
 const c={schemaVersion:2,installationId:randomUUID(),root,machine:'fixture',userSid:target,userProfile:tmpdir(),
 publisherSids:[system],issuerSids:[system],githubEnabled:false,compatibilityEnabled:false,
 profiles:{system:{sid:system,elevated:true,available:true},user:{sid:target,elevated:false,available:true},
 'user-admin':{sid:target,elevated:true,available:false,reason:'TARGET_NOT_ADMINISTRATOR'}}};
 for(const p of ['grants','revoked','requests','events',...['system','user','user-admin'].flatMap(x=>['queue','claims','responses','cancel','work'].map(y=>'lanes/'+x+'/'+y))])mkdirSync(join(root,p),{recursive:true});
 const input={task:'authorized fixture',profiles:['system','user'],capabilities:['identity','process','script'],callerSids:[system],durationSeconds:600,allowAnyCode:true};
 const g=createGrant(c,input,who);
 return {c,g,input,r:{id:randomUUID(),grantId:g.id,profile:'system',operation:'identity',input:{}}};
}
test('standard accounts cannot receive an elevated-user grant and no intent is created',()=>{
 const {c,g,input,r}=fixture();
 assert.throws(()=>createGrant(c,{...input,profiles:['user-admin']},who),{code:'ADMIN_PROFILE_UNAVAILABLE'});
 const altered={...g,profiles:['user-admin']};writeFileSync(join(c.root,'grants',g.id+'.json'),JSON.stringify(altered));
 assert.throws(()=>enqueue(c,{...r,profile:'user-admin'},{identity:who,codec}),{code:'ADMIN_PROFILE_UNAVAILABLE'});
 assert.equal(existsSync(join(c.root,'requests',r.id+'.json')),false);
});
test('Windows-only installation refuses GitHub requests before durable admission',()=>{
 const {c,g,r}=fixture();
 writeFileSync(join(c.root,'grants',g.id+'.json'),JSON.stringify({...g,capabilities:['github']}));
 assert.throws(()=>enqueue(c,{...r,profile:'user',operation:'github.request',input:{method:'GET',path:'/user'}},{identity:who,codec}),{code:'ADMIN_GITHUB_UNAVAILABLE'});
 assert.equal(existsSync(join(c.root,'requests',r.id+'.json')),false);
});
test('Windows-only grants cannot promise a disabled GitHub adapter',()=>{
 const {c,input}=fixture();
 assert.throws(()=>createGrant(c,{...input,capabilities:['github']},who),{code:'ADMIN_GITHUB_UNAVAILABLE'});
});
test('malformed availability and enabled adapters without identity are rejected',()=>{
 const {c}=fixture();
 assert.throws(()=>validateConfig({...c,profiles:{...c.profiles,user:{...c.profiles.user,available:'yes'}}}),{code:'ADMIN_CONFIG_REJECTED'});
 assert.throws(()=>validateConfig({...c,githubEnabled:true}),{code:'ADMIN_CONFIG_REJECTED'});
});
test('independent target stores retain results across reopening without replaying effects',async()=>{
 const {c,g,r}=fixture();enqueue(c,r,{identity:who,codec});let effects=0;
 await processQueue(c,'system',{identity:who,codec,execute:async()=>({count:++effects})});
 const reopen=JSON.parse(JSON.stringify(c));assert.equal(resultFor(reopen,r.id).data.count,1);
 enqueue(reopen,r,{identity:who,codec});await processQueue(reopen,'system',{identity:who,codec,execute:async()=>({count:++effects})});
 assert.equal(effects,1);
 const other=fixture();other.c.userSid='S-1-5-21-1-2-3-1002';
 other.c.profiles.user.sid=other.c.userSid;other.c.profiles['user-admin'].sid=other.c.userSid;
 writeFileSync(join(other.c.root,'grants',g.id+'.json'),readFileSync(join(c.root,'grants',g.id+'.json')));
 assert.throws(()=>authorize(other.c,g,r,who),{code:'ADMIN_GRANT_REJECTED'});
});
test('an offline target keeps SYSTEM maintenance but rejects unavailable user contexts',()=>{
 const {c,input,r}=fixture();c.profiles.user.available=false;c.profiles.user.reason='USER_PROFILE_NOT_CREATED';
 const g=createGrant(c,{...input,profiles:['system']},who);
 assert.equal(authorize(c,g,{...r,grantId:g.id},who).id,g.id);
 assert.throws(()=>createGrant(c,{...input,profiles:['user']},who),{code:'ADMIN_PROFILE_UNAVAILABLE'});
});
