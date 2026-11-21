import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,copyFileSync,existsSync,statSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
const source=fileURLToPath(new URL('../scripts/',import.meta.url));
const win=process.platform==='win32';
function compile(output,files,gui=false){
 const csc=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 if(files.some(f=>f.endsWith('Launcher.cs')))files=[...files,join(source,'admin-sidecar/LauncherProcess.cs')];
 const p=spawnSync(csc,['/nologo',gui?'/target:winexe':'/target:exe','/r:System.Web.Extensions.dll','/out:'+output,...files],{encoding:'utf8',windowsHide:true});
 assert.equal(p.status,0,p.stdout+p.stderr);
}
function fixture(t){
 const root=realpathSync.native(mkdtempSync(join(tmpdir(),'sidecar-windowless-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const dir of ['bin','runtime','releases/3.0.0-aaaaaaaaaaaa','compat','data/legacy'])mkdirSync(join(root,dir),{recursive:true});
 writeFileSync(join(root,'installation.json'),JSON.stringify({schemaVersion:2,name:'hashi-admin-sidecar',releaseId:'3.0.0-aaaaaaaaaaaa',compatibility:true}));
 for(const file of ['bin/launcher.mjs','releases/3.0.0-aaaaaaaaaaaa/cli.mjs','compat/github-user-sidecar.mjs'])writeFileSync(join(root,file),'');
 const probe=join(root,'probe.cs');
 writeFileSync(probe,'using System;using System.Runtime.InteropServices;using System.Web.Script.Serialization;\nclass Probe{[DllImport("kernel32.dll")]static extern IntPtr GetConsoleWindow();\nstatic int Main(string[] args){Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);var timer=new System.Threading.Timer(_=>Environment.Exit(98),null,5000,System.Threading.Timeout.Infinite);Console.Out.WriteLine(new JavaScriptSerializer().Serialize(new {console=GetConsoleWindow().ToInt64(),args=args,input=Console.In.ReadToEnd()}));Console.Error.Write("probe-stderr");GC.KeepAlive(timer);return 37;}}');
 compile(join(root,'runtime/node.exe'),[probe]);
 return root;
}
test('installed scheduled workers use a GUI launcher instead of a console runtime',()=>{
 const installer=readFileSync(join(source,'install-admin-sidecar.ps1'),'utf8');
 assert.match(installer,/target:winexe/);
 assert.match(installer,/hashi-admin-worker\.exe/);
 assert.doesNotMatch(installer,/exe=\$config\.nodePath;arguments=/);
});
test('native CLI keeps its child console-free while preserving argv, streams and exit status',{skip:!win},t=>{
 const root=fixture(t),exe=join(root,'bin/hashi-admin.exe');
 compile(exe,[join(source,'admin-sidecar/Launcher.cs')]);
 const args=['space value','quote"value','trailing\\','中文','& echo not-a-shell',''];
 const p=spawnSync(exe,args,{input:'literal stdin 中文',encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(p.status,37,p.stderr);
 const probe=JSON.parse(p.stdout);
 assert.equal(probe.console,0,'a console-free caller must not allocate a child console');
 assert.deepEqual(probe.args,[join(root,'bin/launcher.mjs'),...args]);
 assert.equal(probe.input,'literal stdin 中文');assert.equal(p.stderr,'probe-stderr');
});
test('GUI worker preserves worker routing and rejects extra arguments',{skip:!win},t=>{
 const root=fixture(t),exe=join(root,'bin/hashi-admin-worker.exe');
 compile(exe,[join(source,'admin-sidecar/WorkerLauncher.cs')],true);
 const pe=readFileSync(exe),header=pe.readUInt32LE(0x3c);
 assert.equal(pe.readUInt16LE(header+24+68),2,'worker itself must have the Windows GUI subsystem');
 for(const profile of ['system','user','user-admin']){
  const p=spawnSync(exe,['--profile',profile],{input:'worker input',encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(p.status,37,p.stderr);const v=JSON.parse(p.stdout);
  assert.equal(v.console,0);assert.equal(v.input,'worker input');
  assert.deepEqual(v.args,[join(root,'releases/3.0.0-aaaaaaaaaaaa/cli.mjs'),'--worker','--profile',profile]);
 }
 const compat=spawnSync(exe,['--compat'],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(compat.status,37,compat.stderr);
 assert.deepEqual(JSON.parse(compat.stdout).args,[join(root,'compat/github-user-sidecar.mjs'),'--worker','--config',join(root,'data/legacy/config.json')]);
 for(const args of [['--profile','other'],['--profile','user','extra'],['--profile','user','--config','elsewhere'],[]]){
  const p=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(p.status,2);assert.equal(p.stdout,'');
 }
});

function killOwned(pid,root){const q=s=>"'"+s.replaceAll("'","''")+"'";const command="$p=Get-CimInstance Win32_Process -Filter 'ProcessId="+pid+"';if($p.ExecutablePath -and $p.ExecutablePath.StartsWith("+q(root+'\\')+")){Stop-Process -Id "+pid+" -Force}";const p=spawnSync('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(p.status,0,p.stderr);}
function live(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function waitUntil(check){const until=Date.now()+8000;while(Date.now()<until){if(check())return;await new Promise(r=>setTimeout(r,30));}assert.fail('native worker observation timed out');}
function nodeFixture(t,behavior){
 const root=fixture(t);
 copyFileSync(process.execPath,join(root,'runtime/node.exe'));
 for(const lane of ['system','user','user-admin'])mkdirSync(join(root,'data/lanes',lane,'work'),{recursive:true});
 mkdirSync(join(root,'data/legacy/work'),{recursive:true});
 const entry=String.raw`import{writeFileSync,appendFileSync}from'node:fs';import{spawn}from'node:child_process';
if(process.argv.includes('--descendant')){writeFileSync(process.env.PROBE_ROOT+'/grandchild',String(process.pid));setInterval(()=>appendFileSync(process.env.PROBE_ROOT+'/effects','x'),50);}
else{const c=spawn(process.execPath,['--input-type=module','-e',process.env.PROBE_SOURCE,'--','--descendant'],{stdio:'ignore',windowsHide:true,env:process.env});writeFileSync(process.env.PROBE_ROOT+'/child',String(process.pid));if(process.env.PROBE_BEHAVIOR==='exit')setTimeout(()=>process.exit(37),800);else setInterval(()=>{},1000);c.on('error',()=>process.exit(99));}
`;
 for(const file of ['releases/3.0.0-aaaaaaaaaaaa/cli.mjs','compat/github-user-sidecar.mjs'])writeFileSync(join(root,file),entry);
 const exe=join(root,'bin/hashi-admin-worker.exe');compile(exe,[join(source,'admin-sidecar/WorkerLauncher.cs')],true);
 return {root,exe,env:{...process.env,PROBE_ROOT:root.replaceAll('\\','/'),PROBE_SOURCE:entry,PROBE_BEHAVIOR:behavior}};
}
for(const route of ['system','user','user-admin','compat']){
 test('worker job ends descendants on abrupt '+route+' launcher termination',{skip:!win},async t=>{
  const f=nodeFixture(t,'hold'),args=route==='compat'?['--compat']:['--profile',route];
  const p=spawn(f.exe,args,{env:f.env,stdio:'ignore',windowsHide:true});
  let child,grandchild;
  t.after(()=>{if(p.exitCode===null)p.kill();for(const pid of [child,grandchild])if(pid&&live(pid))killOwned(pid,f.root);});
  await waitUntil(()=>existsSync(join(f.root,'grandchild'))&&existsSync(join(f.root,'effects')));
  child=Number(readFileSync(join(f.root,'child'),'utf8'));grandchild=Number(readFileSync(join(f.root,'grandchild'),'utf8'));
  assert(live(child)&&live(grandchild));
  const ended=new Promise(resolve=>p.once('exit',resolve));p.kill();await ended;
  await waitUntil(()=>!live(child)&&!live(grandchild));
  const before=statSync(join(f.root,'effects')).size;await new Promise(r=>setTimeout(r,200));assert.equal(statSync(join(f.root,'effects')).size,before);
 });
}
test('normal worker exit preserves status and ends remaining descendants',{skip:!win},async t=>{
 const f=nodeFixture(t,'exit'),p=spawn(f.exe,['--profile','user'],{env:f.env,stdio:'ignore',windowsHide:true});
 let child,grandchild;const ended=new Promise(resolve=>p.once('exit',resolve));
 t.after(()=>{if(p.exitCode===null)p.kill();for(const pid of [child,grandchild])if(pid&&live(pid))killOwned(pid,f.root);});
 await waitUntil(()=>existsSync(join(f.root,'grandchild')));
 child=Number(readFileSync(join(f.root,'child'),'utf8'));grandchild=Number(readFileSync(join(f.root,'grandchild'),'utf8'));
 assert.equal(await ended,37);await waitUntil(()=>!live(child)&&!live(grandchild));
});
for(const mode of ['manifest','payload','node-start']){
 test('worker startup reports sanitized '+mode+' failure without launching work',{skip:!win},t=>{
  const root=fixture(t),exe=join(root,'bin/hashi-admin-worker.exe');compile(exe,[join(source,'admin-sidecar/WorkerLauncher.cs')],true);
  for(const lane of ['system','user','user-admin'])mkdirSync(join(root,'data/lanes',lane,'work'),{recursive:true});
  if(mode==='manifest')writeFileSync(join(root,'installation.json'),'{invalid-private-fixture-text');
  if(mode==='payload')unlinkSync(join(root,'runtime/node.exe'));
  if(mode==='node-start')writeFileSync(join(root,'runtime/node.exe'),'invalid executable');
  const p=spawnSync(exe,['--profile','user'],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(p.status,2);assert.equal(p.stdout,'');
  const report=JSON.parse(p.stderr);assert.equal(report.error.code,'ADMIN_WORKER_LAUNCH_FAILED');assert.equal(report.error.stage,mode);
  assert.equal(Number.isInteger(report.error.win32),true);
  if(mode==='node-start')assert(report.error.win32>0);
  assert(!p.stderr.includes('invalid-private-fixture-text'));assert(!p.stderr.includes(root));
  const paths=['system','user','user-admin'].map(l=>join(root,'data/lanes',l,'work/worker-startup.json'));
  const diagnostics=paths.filter(existsSync);assert.equal(diagnostics.length,1);assert.deepEqual(JSON.parse(readFileSync(diagnostics[0],'utf8')),report);
 });
}
