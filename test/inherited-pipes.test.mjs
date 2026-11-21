import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const source=fileURLToPath(new URL('../scripts/',import.meta.url));
function compile(exe,files,gui){files=[...files,join(source,'admin-sidecar/LauncherProcess.cs')];const p=spawnSync(join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo',gui?'/target:winexe':'/target:exe','/r:System.Web.Extensions.dll','/out:'+exe,...files],{encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stdout+p.stderr);}
function live(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function cleanup(root){
 const q="'"+root.replaceAll("'","''")+"\\'";
 const p=spawnSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith("+q+",[StringComparison]::OrdinalIgnoreCase)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}"],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(p.status,0,p.stderr);
 rmSync(root,{force:true,recursive:true});
}
const descendant=String.raw`const fs=require('node:fs');fs.writeFileSync(process.env.PROBE_ROOT+'/descendant',String(process.pid));let ready=false;setInterval(()=>{fs.appendFileSync(process.env.PROBE_ROOT+'/effects','effect\n');if(!ready&&process.send){ready=true;process.send('ready');process.disconnect();}},50);setTimeout(()=>process.exit(0),30000);`;
const entry=String.raw`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';
const stream=process.env.INHERITED_STREAM;
const child=spawn(process.execPath,['-e',process.env.DESCENDANT],{windowsHide:true,detached:true,stdio:['ignore',stream==='stdout'?'inherit':'ignore',stream==='stderr'?'inherit':'ignore','ipc']});
writeFileSync(process.env.PROBE_ROOT+'/node',String(process.pid));
process.stdout.write('ordinary 中文 stdout\n');process.stderr.write('ordinary 中文 stderr\n');
child.once('message',()=>process.exit(37));
`;
function fixture(t,launcher){
 const root=mkdtempSync(join(tmpdir(),'sidecar-inherited-'));t.after(()=>cleanup(root));
 for(const d of ['bin','runtime','releases/3.0.0-aaaaaaaaaaaa','compat'])mkdirSync(join(root,d),{recursive:true});
 copyFileSync(process.execPath,join(root,'runtime/node.exe'));
 writeFileSync(join(root,'installation.json'),JSON.stringify({releaseId:'3.0.0-aaaaaaaaaaaa',compatibility:true}));
 for(const f of ['bin/launcher.mjs','releases/3.0.0-aaaaaaaaaaaa/cli.mjs','compat/github-user-sidecar.mjs'])writeFileSync(join(root,f),entry);
 const exe=join(root,'bin/probe.exe');compile(exe,[join(source,launcher)],launcher.endsWith('WorkerLauncher.cs'));
 return {root,exe};
}
for(const route of ['system','user','user-admin','compat','admin-cli','github-cli'])for(const stream of ['stdout','stderr']){
 test(route+' returns normally when descendant inherits '+stream,{skip:process.platform!=='win32'},async t=>{
  const {root,exe}=fixture(t,route==='admin-cli'?'admin-sidecar/Launcher.cs':route==='github-cli'?'github-sidecar/Launcher.cs':'admin-sidecar/WorkerLauncher.cs');
  const p=spawn(exe,route==='compat'?['--compat']:route.endsWith('-cli')?[]:['--profile',route],{env:{...process.env,PROBE_ROOT:root.replaceAll('\\','/'),INHERITED_STREAM:stream,DESCENDANT:descendant},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
  const ended=new Promise(resolve=>p.once('exit',(code,signal)=>resolve({code,signal})));
  let timer;const result=await Promise.race([ended,new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),5000);})]);clearTimeout(timer);
  assert(!result.timeout,'launcher remained blocked after Node exited and inherited '+stream+' remained open');
  assert.equal(result.code,37);await delay(100);
  assert(existsSync(join(root,'descendant')));const pid=Number(readFileSync(join(root,'descendant'),'utf8'));
  assert.equal(live(pid),false,'owned descendant survives launcher completion');
  const before=statSync(join(root,'effects')).size;await delay(200);assert.equal(statSync(join(root,'effects')).size,before);
  assert.equal(out,'ordinary 中文 stdout\n');assert.equal(err,'ordinary 中文 stderr\n');
 });
}

for(const launcher of ['admin-sidecar/Launcher.cs','github-sidecar/Launcher.cs']){
 test(launcher+' forwards complete large ordinary CLI output and UTF-8 input',{skip:process.platform!=='win32'},t=>{
  const {root,exe}=fixture(t,launcher);
  const script=String.raw`import{readFileSync,writeSync}from'node:fs';
const header=Buffer.from(JSON.stringify({argv:process.argv.slice(2),input:readFileSync(0,'utf8')})+'\n');
function all(fd,b){let at=0;while(at<b.length)at+=writeSync(fd,b,at,b.length-at);}
all(1,header);const chunk=Buffer.from('中文😀 stream\n'.repeat(32768));
for(let i=0;i<16;i++)all(1,chunk);for(let i=0;i<16;i++)all(2,chunk);process.exitCode=37;
`;
  writeFileSync(join(root,'bin/launcher.mjs'),script);
  const argv=['space value','quote"value','trailing\\','中文😀','& not-a-shell',''];
  const input='literal stdin 中文😀\n';
  const run=spawnSync(exe,argv,{input:Buffer.from(input),windowsHide:true,timeout:20000,maxBuffer:32*1024*1024});
  assert.equal(run.status,37,run.error?.message);
  const end=run.stdout.indexOf(10),header=JSON.parse(run.stdout.subarray(0,end).toString('utf8'));
  assert.deepEqual(header,{argv,input});
  const chunk=Buffer.from('中文😀 stream\n'.repeat(32768)),expected=Buffer.concat(Array(16).fill(chunk));
  const out=run.stdout.subarray(end+1);
  assert.equal(out.length,expected.length);assert.equal(run.stderr.length,expected.length);
  assert.equal(Buffer.compare(out,expected),0);assert.equal(Buffer.compare(run.stderr,expected),0);
 });
}
