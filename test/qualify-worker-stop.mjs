import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,statSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {enqueue} from '../scripts/github-user-sidecar.mjs';
const [install,evidence,sid]=process.argv.slice(2);
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const config=read(join(install,'data/config.json'));
const legacy=read(join(install,'data/legacy/config.json'));
const node=join(install,'runtime/node.exe'),cli=join(install,'bin/hashi-admin.exe');
const helper=join(install,'bin/admin-native.exe');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
function ps(command){const p=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';"+command],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(p.status,0,p.stderr);return p.stdout.trim();}
function call(...args){const p=spawnSync(cli,args,{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(p.status,0,p.stdout+p.stderr);return readJson(p.stdout);}
const readJson=s=>JSON.parse(s.replace(/^\uFEFF/,''));
function task(name,action){ps(action+'-ScheduledTask -TaskName '+quote(name)+' | Out-Null'+(action==='Stop'?';$until=[DateTime]::UtcNow.AddSeconds(15);while((Get-ScheduledTask -TaskName '+quote(name)+').State -eq "Running"){if([DateTime]::UtcNow -gt $until){throw "Task did not stop"};Start-Sleep -Milliseconds 100}':''));}
async function until(predicate){const end=Date.now()+15000;while(Date.now()<end){if(predicate())return;await delay(100);}throw Error('Fixture readiness timed out');}
function processes(){const r=ps('Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and ($_.ExecutablePath.StartsWith('+quote(install+'\\')+') -or $_.ExecutablePath -eq '+quote(join(evidence,'fake-gh.exe'))+' -or ($_.Name -eq "node.exe" -and $_.CommandLine.Contains("worker-stop-probe.mjs") -and $_.CommandLine.Contains('+quote(evidence)+')))} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate | ConvertTo-Json -Compress');const v=r?readJson(r):[];return Array.isArray(v)?v:[v];}
function size(p){return existsSync(p)?statSync(p).size:0;}
const taskNames=[...Object.values(config.profiles).filter(p=>p.available).map(p=>p.taskName),config.legacyTaskName];
const scope=join(evidence,'scope.json');
writeFileSync(scope,JSON.stringify({task:'Disposable Scheduled Task worker stop regression',profiles:['system','user','user-admin'],capabilities:['process'],allowAnyCode:true,callerSids:['S-1-5-18'],durationSeconds:1800}));
const grant=call('grant-create','--input-file',scope).grant.id;
let rows=[],failures=0;
try{
 for(const profile of ['system','user','user-admin','compat']){
  const taskName=profile==='compat'?config.legacyTaskName:config.profiles[profile].taskName;
  const id=randomUUID(),base=join(evidence,profile);
  if(profile==='compat'){
   enqueue(legacy,{operation:'account'},{id});task(taskName,'Start');
  }else{
   const input=join(evidence,profile+'-input.json');
   writeFileSync(input,JSON.stringify({executable:node,args:[join(import.meta.dirname,'fixtures/worker-stop-probe.mjs'),evidence,profile,helper],cwd:evidence,timeoutMs:40000}));
   call('submit','--grant',grant,'--profile',profile,'--operation','process.run','--request-id',id,'--input-file',input);
  }
  await until(()=>existsSync(base+'-child.effects')&&size(base+'-child.effects')>0);
  const observed=read(base+'.json'),identity=observed.identity;
  if(identity.elevated)await until(()=>size(observed.privilegedPath)>0);else assert.equal(observed.protectedWriteDenied,true);
  assert.equal(identity.sid,profile==='system'?'S-1-5-18':sid);
  assert.equal(identity.elevated,profile==='system'||profile==='user-admin');
  task(taskName,'Stop');
  await delay(300);
  const afterStop=processes(),before=size(base+'-child.effects'),privilegedBefore=observed.privilegedPath?size(observed.privilegedPath):0;
  await delay(1000);
  const stoppedEffects=size(base+'-child.effects')===before;
  const stoppedPrivilegedEffects=!observed.privilegedPath||size(observed.privilegedPath)===privilegedBefore;
  const survived=afterStop.length>0;
  // Stop only this explicit fixture's descendants; never match a bare process name.
  if(survived){ps('Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and ($_.ExecutablePath.StartsWith('+quote(install+'\\')+') -or $_.ExecutablePath -eq '+quote(join(evidence,'fake-gh.exe'))+' -or ($_.Name -eq "node.exe" -and $_.CommandLine.Contains("worker-stop-probe.mjs") -and $_.CommandLine.Contains('+quote(evidence)+')))} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}');}
  const starts=size(base+'.starts');
  task(taskName,'Start');await delay(2000);
  const noReplay=size(base+'.starts')===starts;
  task(taskName,'Stop');
  const row={profile,id,identity,survivors:afterStop,stoppedEffects,stoppedPrivilegedEffects,protectedWriteDenied:observed.protectedWriteDenied,noReplay,passed:!survived&&stoppedEffects&&stoppedPrivilegedEffects&&noReplay};
  rows.push(row);if(!row.passed)failures++;
  writeFileSync(join(evidence,'observations.json'),JSON.stringify(rows,null,2));
  console.log(JSON.stringify(row));
 }

 // A real SYSTEM task whose owned launcher cannot start Node must leave a
 // structured failure and a nonzero Scheduled Task result, without a child.
 const fault=join(evidence,'startup-failure'),faultName='HashiSidecar-test-startup-'+randomUUID();
 const work=join(fault,'data/lanes/system/work');
 ps('New-Item -ItemType Directory -Force -Path '+quote(join(fault,'bin'))+','+quote(work)+','+quote(join(fault,'runtime'))+','+quote(join(fault,'releases/3.0.0-aaaaaaaaaaaa'))+' | Out-Null');
 copyFileSync(join(install,'bin/hashi-admin-worker.exe'),join(fault,'bin/hashi-admin-worker.exe'));
 writeFileSync(join(fault,'installation.json'),JSON.stringify({releaseId:'3.0.0-aaaaaaaaaaaa',compatibility:false}));
 writeFileSync(join(fault,'runtime/node.exe'),'invalid executable');
 writeFileSync(join(fault,'releases/3.0.0-aaaaaaaaaaaa/cli.mjs'),'');
 const faultExe=join(fault,'bin/hashi-admin-worker.exe');
 ps('$a=New-ScheduledTaskAction -Execute '+quote(faultExe)+' -Argument "--profile system";$p=New-ScheduledTaskPrincipal -UserId "S-1-5-18" -LogonType ServiceAccount -RunLevel Highest;Register-ScheduledTask -TaskName '+quote(faultName)+' -Action $a -Principal $p -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 20)) | Out-Null');
 taskNames.push(faultName);task(faultName,'Start');
 await until(()=>existsSync(join(work,'worker-startup.json')));
 await until(()=>ps('[string](Get-ScheduledTask -TaskName '+quote(faultName)+').State')!=='Running');
 const diagnostic=read(join(work,'worker-startup.json'));
 assert.equal(diagnostic.error.code,'ADMIN_WORKER_LAUNCH_FAILED');assert.equal(diagnostic.error.stage,'node-start');assert(diagnostic.error.win32>0);
 const taskResult=Number(ps('(Get-ScheduledTaskInfo -TaskName '+quote(faultName)+').LastTaskResult'));assert.equal(taskResult,2);
 rows.push({profile:'startup-failure',passed:true,taskResult,diagnostic});
 writeFileSync(join(evidence,'observations.json'),JSON.stringify(rows,null,2));
 console.log(JSON.stringify(rows.at(-1)));

}finally{
 let cleanupError;
 try{call('grant-revoke','--grant',grant);}catch(error){cleanupError=error;}
 for(const name of taskNames){try{task(name,'Stop');task(name,'Disable');}catch(error){cleanupError ||= error;}}
 writeFileSync(join(evidence,'cleanup.json'),JSON.stringify({tasks:taskNames,grantRevoked:!cleanupError,stoppedAndDisabled:!cleanupError},null,2));
 if(cleanupError)throw cleanupError;
}
console.log(JSON.stringify({passed:rows.length-failures,failed:failures,realScheduledTasks:true}));
process.exitCode=failures?1:0;
