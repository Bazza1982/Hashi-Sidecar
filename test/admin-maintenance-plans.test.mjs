import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {maintenanceOperation} from '../scripts/admin-sidecar/maintenance.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'admin-plans-')),id=randomUUID(),grantId=randomUUID();
 const c={root,installationId:randomUUID()},r={id,grantId,profile:'system',operation:'acl.plan',input:{path:join(root,'owned'),changes:[{action:'grant',sid:'S-1-5-18',rights:'Read'}]}};
 let writes=0;const native=(c,op,input)=>op==='acl.inspect'?{fileId:'fixture:1'}:op==='acl.plan'?{path:r.input.path,fileId:'fixture:1',beforeHash:'before',afterHash:'after',changes:r.input.changes}:(writes++,{changed:true,descriptorHash:'after'});
 return {c,r,ctx:{grant:{expiresAt:1000000}},native,writes:()=>writes};
}
test('protected ACL plans bind the grant, profile, installation and expected path',()=>{
 const f=fixture(),p=maintenanceOperation(f.c,f.r,f.ctx,{native:f.native,now:()=>100});
 const apply={...f.r,id:randomUUID(),operation:'acl.apply',input:{path:f.r.input.path,planId:p.planId}};
 for(const r of [{...apply,grantId:randomUUID()},{...apply,profile:'user-admin'},{...apply,input:{...apply.input,path:join(f.c.root,'different')}}]){
 assert.throws(()=>maintenanceOperation(f.c,r,f.ctx,{native:f.native,now:()=>200}),{code:'ADMIN_ACL_PLAN_REJECTED'});
 }
 assert.equal(f.writes(),0);assert.equal(maintenanceOperation(f.c,apply,f.ctx,{native:f.native,now:()=>200}).planId,p.planId);assert.equal(f.writes(),1);
});
test('expired ACL plans perform no mutation and preserve the original plan for reconciliation',()=>{
 const f=fixture(),p=maintenanceOperation(f.c,f.r,f.ctx,{native:f.native,now:()=>100});
 const apply={...f.r,id:randomUUID(),operation:'acl.apply',input:{path:f.r.input.path,planId:p.planId}};
 assert.throws(()=>maintenanceOperation(f.c,apply,f.ctx,{native:f.native,now:()=>1000001}),{code:'ADMIN_ACL_PLAN_EXPIRED'});assert.equal(f.writes(),0);
});
