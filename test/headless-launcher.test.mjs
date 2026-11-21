import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const source=fileURLToPath(new URL('../scripts/',import.meta.url));
const win=process.platform==='win32';
function compile(output,files,gui=false){
 const csc=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
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
