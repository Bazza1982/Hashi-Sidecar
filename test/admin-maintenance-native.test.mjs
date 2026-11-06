import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,renameSync,linkSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {maintenanceOperation} from '../scripts/admin-sidecar/maintenance.mjs';
const windows=process.platform==='win32',source=fileURLToPath(new URL('../scripts/admin-sidecar/Maintenance.cs',import.meta.url));
let folder,exe;
function build(){
 if(exe)return exe;folder=mkdtempSync(join(tmpdir(),'admin-acl-native-'));exe=join(folder,'maintenance-native.exe');
 const p=spawnSync(join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
 ['/nologo','/target:exe','/r:System.Web.Extensions.dll','/r:System.Security.dll','/out:'+exe,source],{encoding:'utf8'});
 assert.equal(p.status,0,p.stdout+p.stderr);return exe;
}
function call(op,input,ok=true){
 const p=spawnSync(build(),[op],{input:JSON.stringify(input),encoding:'utf8',timeout:15000});
 const r=JSON.parse(p.stdout);if(ok)assert.equal(r.ok,true,JSON.stringify(r));return r;
}
const sid1='S-1-5-21-111-222-333-9991',sid2='S-1-5-21-111-222-333-9992';
function file(name){build();const path=join(folder,name);writeFileSync(path,'fixture-private-value-do-not-return');return path;}
function plan(path,sid=sid1){return call('acl.plan',{path,changes:[{action:'grant',sid,rights:'Read'}]}).data;}
test('native ACL plan/apply/conditional restore preserves bytes and unrelated descriptor rules',{skip:!windows},()=>{
 const path=file('credential.txt'),before=call('acl.inspect',{path}).data,content=readFileSync(path),p=plan(path);
 assert.equal(p.beforeHash,before.descriptorHash);assert.notEqual(p.afterHash,p.beforeHash);
 const applied=call('acl.apply',p).data;assert.equal(applied.changed,true);assert.equal(applied.descriptorHash,p.afterHash);
 assert.deepEqual(readFileSync(path),content);assert.equal(applied.contentsWritten,false);
 assert.equal(call('acl.apply',p).data.reused,true);
 const restored=call('acl.restore',p).data;assert.equal(restored.descriptorHash,p.beforeHash);assert.deepEqual(readFileSync(path),content);
 assert.equal(call('acl.inspect',{path}).data.ownerSid,before.ownerSid);
});
test('ACL apply and restore refuse stale descriptors rather than overwriting another repair',{skip:!windows},()=>{
 const path=file('concurrent.txt'),first=plan(path),second=plan(path,sid2);
 call('acl.apply',second);
 const stale=call('acl.apply',first,false);assert.equal(stale.error.code,'ADMIN_STALE_SECURITY_DESCRIPTOR');
 call('acl.restore',second);call('acl.apply',first);
 const third=plan(path,sid2);call('acl.apply',third);
 assert.equal(call('acl.restore',first,false).error.code,'ADMIN_STALE_SECURITY_DESCRIPTOR');
 call('acl.restore',third);call('acl.restore',first);
});
test('ACL plans are bound to file identity across atomic replacement',{skip:!windows},()=>{
 const path=file('replace.txt'),p=plan(path);renameSync(path,path+'.old');writeFileSync(path,'new-generation');
 assert.equal(call('acl.apply',p,false).error.code,'ADMIN_STALE_FILE_IDENTITY');assert.equal(readFileSync(path,'utf8'),'new-generation');
});
test('metadata repair rejects junction substitution and unexpected hard links',{skip:!windows},()=>{
 const path=file('linked.txt');linkSync(path,path+'.other');
 assert.equal(call('acl.plan',{path,changes:[{action:'grant',sid:sid1,rights:'Read'}]},false).error.code,'ADMIN_HARDLINK_REJECTED');
 const junction=join(folder,'junction');symlinkSync(folder,junction,'junction');
 assert.equal(call('acl.inspect',{path:join(junction,'linked.txt')},false).error.code,'ADMIN_PATH_REJECTED');
 rmSync(junction);
});
test('credential probe reads through its actual token without returning file contents',{skip:!windows},()=>{
 const path=file('probe.txt'),r=call('file.probe',{path}).data;
 assert.equal(r.readable,true);assert.equal(r.complete,true);assert.equal(r.contentsReturned,false);
 assert.ok(!JSON.stringify(r).includes('fixture-private-value'));
});
test('guarded native termination rejects a reused identity and waits for the exact process',{skip:!windows},async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 try{
  const observed=call('process.inspect',{pid:child.pid}).data;
  assert.equal(observed.pid,child.pid);assert.match(observed.creationTicks,/^\d+$/);
  const input={pid:child.pid,expectedExecutable:observed.executable,expectedCreationTicks:observed.creationTicks,timeoutMs:5000};
  assert.equal(call('process.stop',{...input,expectedCreationTicks:'638000000000000000'},false).error.code,'ADMIN_STALE_PROCESS');
  const stopped=call('process.stop',input).data;assert.equal(stopped.stopped,true);assert.equal(stopped.targetExitCode,1460);assert.equal(Object.hasOwn(stopped,'exitCode'),false);
  await new Promise(r=>setTimeout(r,100));assert.throws(()=>process.kill(child.pid,0));
 }finally{try{child.kill();}catch{}}
});
after(()=>{if(folder)rmSync(folder,{recursive:true,force:true});});

test('native metadata accepts a legitimate Windows short-path alias for the same local file',{skip:!windows},t=>{
 const path=file('long-file-name-for-short-path.txt');
 const definition='[System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern uint GetShortPathName(string p,System.Text.StringBuilder b,uint n);';
 const command="Add-Type -MemberDefinition '"+definition+"' -Name Paths -Namespace SidecarFixture;$b=[Text.StringBuilder]::new(32768);[void][SidecarFixture.Paths]::GetShortPathName($env:SIDECAR_FIXTURE_PATH,$b,32768);[Console]::Write($b.ToString())";
 const p=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],
 {encoding:'utf8',env:{...process.env,SIDECAR_FIXTURE_PATH:path}});
 assert.equal(p.status,0,p.stderr);const alias=p.stdout.trim();
 if(!alias||alias.toLowerCase()===path.toLowerCase()){t.skip('Volume provides no short alias for this fixture');return;}
 assert.equal(call('acl.inspect',{path:alias}).data.fileId,call('acl.inspect',{path}).data.fileId);
 const c={root:folder,installationId:randomUUID(),helperPath:join(folder,'admin-native.exe')};
 const r={id:randomUUID(),grantId:randomUUID(),profile:'system',operation:'acl.plan',input:{path:alias,changes:[{action:'grant',sid:sid1,rights:'Read'}]}};
 const ctx={grant:{expiresAt:Date.now()+60000}},aliasPlan=maintenanceOperation(c,r,ctx);
 const applied=maintenanceOperation(c,{...r,id:randomUUID(),operation:'acl.apply',input:{path:alias,planId:aliasPlan.planId}},ctx);
 assert.equal(applied.changed,true);
 maintenanceOperation(c,{...r,id:randomUUID(),operation:'acl.restore',input:{path:alias,planId:aliasPlan.planId}},ctx);
});
