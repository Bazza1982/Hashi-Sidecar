import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const windows=process.platform==='win32';
const source=fileURLToPath(new URL('../scripts/admin-sidecar/Native.cs',import.meta.url));
let exe,folder;
function build(){
 if(exe)return exe;folder=mkdtempSync(join(tmpdir(),'admin-native-'));exe=join(folder,'native.exe');
 const csc=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const p=spawnSync(csc,['/nologo','/target:exe','/r:System.Web.Extensions.dll','/r:System.Security.dll','/out:'+exe,source],{encoding:'utf8'});
 assert.equal(p.status,0,p.stdout+p.stderr);return exe;
}
function native(mode,input){
 const p=spawnSync(build(),[mode],{input:typeof input==='string'?input:JSON.stringify(input),encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
 assert.equal(p.status,0,p.stderr);return mode==='run'||mode==='identity'?JSON.parse(p.stdout):p.stdout.trim();
}
test('native helper observes its actual token and DPAPI protects and restores payloads',{skip:!windows},()=>{
 const who=native('identity');assert.match(who.sid,/^S-1-/);assert.equal(typeof who.elevated,'boolean');assert.ok(who.machine);
 const input='private payload unicode 中文',cipher=native('protect',input);assert.ok(!cipher.includes(input));
 assert.equal(Buffer.from(native('unprotect',cipher),'base64').toString('utf8'),input);
});
test('native job starts suspended, owns its process tree, preserves literal argv and stdin',{skip:!windows},()=>{
 const args=['space value','a&b','$HOME','trailing\\','"quoted"','中文'];
 const code='let x="";process.stdin.setEncoding("utf8");process.stdin.on("data",s=>x+=s);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({args:process.argv.slice(1),stdin:x})))';
 const r=native('run',{executable:process.execPath,args:['-e',code,...args],cwd:tmpdir(),stdin:'literal input',timeoutMs:3000});
 assert.equal(r.exitCode,0);assert.equal(r.jobObject,true);assert.deepEqual(JSON.parse(r.stdout),{args,stdin:'literal input'});
});
test('native timeouts terminate the owned descendant and expose uncertain termination',{skip:!windows},async()=>{
 const pidFile=join(folder||tmpdir(),'descendant-'+Date.now()+'.txt');
 const code='const p=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("node:fs").writeFileSync(process.argv[1],String(p.pid));setInterval(()=>{},1000)';
 const r=native('run',{executable:process.execPath,args:['-e',code,pidFile],cwd:tmpdir(),timeoutMs:800});
 assert.equal(r.termination,'timed_out');assert.ok(existsSync(pidFile));
 const pid=Number(readFileSync(pidFile,'utf8'));await new Promise(r=>setTimeout(r,100));assert.throws(()=>process.kill(pid,0));
});
test('native cancellation and revocation markers stop an active owned job',{skip:!windows},()=>{
 const marker=join(folder,'cancel.json');writeFileSync(marker,'{}');
 for(const key of ['cancelFile','revokedFile']){
 const r=native('run',{executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:tmpdir(),timeoutMs:3000,[key]:marker});
 assert.equal(r.termination,key==='cancelFile'?'cancelled':'grant_revoked');
 }
});
test('native output is bounded in UTF8 bytes and explicitly marks truncation',{skip:!windows},()=>{
 const r=native('run',{executable:process.execPath,args:['-e','process.stdout.write("😀".repeat(100000))'],cwd:tmpdir(),timeoutMs:3000,maxOutputBytes:32768});
 assert.equal(r.exitCode,0);assert.equal(r.stdoutTruncated,true);assert.ok(Buffer.byteLength(r.stdout)<=32768);
});

test('native long-job admission records actual PID and final status without an artificial five-minute cap',{skip:!windows},()=>{
 build();const statusFile=join(folder,'live.json');
 const r=native('run',{executable:process.execPath,args:['-e','process.stdout.write("done")'],cwd:tmpdir(),timeoutMs:3600000,statusFile});
 const live=JSON.parse(readFileSync(statusFile,'utf8'));
 assert.equal(r.exitCode,0);assert.equal(live.state,'finished');assert.equal(live.pid,r.pid);assert.equal(live.exitCode,0);
});
