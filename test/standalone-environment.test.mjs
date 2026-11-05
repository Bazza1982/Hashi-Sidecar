import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {environment} from '../scripts/admin-sidecar/execute.mjs';
test('each target and execution identity has an explicit isolated temporary/cache environment',()=>{
 const root=mkdtempSync(join(tmpdir(),'sidecar-env-')),c={root,userProfile:join(root,'verified-profile')};
 const system=environment(c,'system'),user=environment(c,'user'),admin=environment(c,'user-admin');
 assert.notEqual(system.TEMP,user.TEMP);assert.notEqual(admin.TEMP,user.TEMP);
 assert.equal(user.USERPROFILE,c.userProfile);assert.equal(user.APPDATA,join(c.userProfile,'AppData','Roaming'));
 for(const env of [system,user,admin]){
  assert.equal(env.TEMP,env.TMP);assert.ok(env.TEMP.startsWith(root));assert.ok(existsSync(env.TEMP));
  assert.ok(env.NPM_CONFIG_CACHE.startsWith(env.TEMP));assert.ok(env.PIP_CACHE_DIR.startsWith(env.TEMP));
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'])assert.equal(env[key],undefined);
 }
});
