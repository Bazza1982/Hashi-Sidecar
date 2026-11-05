import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fail,inside,readJSON,atomic,sha} from './core.mjs';

function helper(c,operation,input){
 const exe=join(dirname(c.helperPath),'maintenance-native.exe');
 const p=spawnSync(exe,[operation],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:80000,maxBuffer:2*1024*1024});
 let result;try{result=JSON.parse(p.stdout);}catch{fail('ADMIN_OUTCOME_UNCERTAIN');}
 if(!result.ok)fail(/^ADMIN_[A-Z_]+$/.test(result.error?.code||'')?result.error.code:'ADMIN_NATIVE_REJECTED',{nativeCode:result.error?.nativeCode});
 if(p.status!==0||p.error)fail('ADMIN_OUTCOME_UNCERTAIN');return result.data;
}
export function maintenanceOperation(c,r,ctx,{native=helper,now=()=>Date.now()}={}){
 if(!r.operation.startsWith('acl.')||r.operation==='acl.inspect')return native(c,r.operation,r.input);
 const folder=inside(c.root,'maintenance','plans');mkdirSync(folder,{recursive:true});
 if(r.operation==='acl.plan'){
  const data=native(c,r.operation,r.input);
  const plan={schemaVersion:1,id:r.id,installationId:c.installationId,grantId:r.grantId,profile:r.profile,
   requestedPath:resolve(r.input.path),createdAt:now(),expiresAt:Math.min(ctx.grant.expiresAt,now()+600000),data};
  plan.digest=sha(JSON.stringify(plan));
  writeFileSync(inside(folder,r.id+'.json'),JSON.stringify(plan)+'\n',{flag:'wx'});
  return {planId:r.id,planDigest:plan.digest,path:resolve(r.input.path),canonicalPath:data.path,fileId:data.fileId,beforeHash:data.beforeHash,afterHash:data.afterHash,
   changes:data.changes,expiresAt:plan.expiresAt,contentsRead:false,contentsWritten:false};
 }
 const p=inside(folder,r.input.planId+'.json'),plan=readJSON(p);
 const {digest,...unsigned}=plan;
 if(sha(JSON.stringify(unsigned))!==digest||plan.installationId!==c.installationId||plan.grantId!==r.grantId||plan.profile!==r.profile||
 ![plan.requestedPath||plan.data.path,plan.data.path].some(path=>resolve(path).toLowerCase()===resolve(r.input.path).toLowerCase()))fail('ADMIN_ACL_PLAN_REJECTED');
 if(r.operation==='acl.apply'&&plan.expiresAt<=now())fail('ADMIN_ACL_PLAN_EXPIRED');
 const target=native(c,'acl.inspect',{path:r.input.path});
 if(target.fileId!==plan.data.fileId)fail('ADMIN_STALE_FILE_IDENTITY');
 const data=native(c,r.operation,plan.data);
 const receipt=inside(folder,r.input.planId+'.'+(r.operation==='acl.restore'?'restore':'apply')+'.json');
 atomic(receipt,{requestId:r.id,planId:plan.id,at:now(),...data});
 return {...data,planId:plan.id,rollbackAvailable:r.operation==='acl.apply'};
}
