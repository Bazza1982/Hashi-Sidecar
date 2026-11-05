import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {targetSession} from '../scripts/admin-sidecar/execute.mjs';
test('Windows session admission observes OS session identities and refuses an absent target',{skip:process.platform!=='win32'},()=>{
 const root=mkdtempSync(join(tmpdir(),'sidecar-sessions-')),exe=join(root,'native.exe');
 const build=spawnSync(join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
 ['/nologo','/target:exe','/r:System.Web.Extensions.dll','/r:System.Security.dll','/out:'+exe,fileURLToPath(new URL('../scripts/admin-sidecar/Native.cs',import.meta.url))],{encoding:'utf8'});
 assert.equal(build.status,0,build.stdout+build.stderr);
 const query=spawnSync(exe,['sessions'],{encoding:'utf8'});assert.equal(query.status,0,query.stderr);
 const reply=JSON.parse(query.stdout);assert.equal(reply.complete,true);assert.ok(Array.isArray(reply.sessions));
 for(const row of reply.sessions){assert.match(row.sid,/^S-1-/);assert.ok(Number.isInteger(row.sessionId));}
 assert.throws(()=>targetSession({helperPath:exe,userSid:'S-1-5-21-1-2-3-99999'}),{code:'ADMIN_USER_SESSION_UNAVAILABLE'});
});
