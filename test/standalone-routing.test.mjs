import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {loadSuite,selectTarget,assertTarget} from '../scripts/standalone/accounts.mjs';
import {installation} from '../scripts/admin-sidecar/bootstrap.mjs';
const sid='S-1-5-21-1-2-3-1001',hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'sidecar-routing-')),accountRoot=join(root,'accounts',sid),id=randomUUID(),release='3.0.0-'+'a'.repeat(12);
 const names=['bin/launcher.mjs','bin/hashi-admin.exe','bin/admin-native.exe','bin/maintenance-native.exe','runtime/node.exe','runtime/LICENSE',
 ...['cli.mjs','core.mjs','execute.mjs','actions.ps1','maintenance.mjs'].map(p=>'releases/'+release+'/'+p)];
 const account={schemaVersion:2,name:'hashi-admin-sidecar',version:'3.0.0',releaseId:release,compatibility:false,config:'data/config.json',files:{}};
 for(const name of names){const path=join(accountRoot,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'fixture');account.files[name]=hash('fixture');}
 const config={root:join(accountRoot,'data'),programRoot:accountRoot,installationId:id,userSid:sid,githubEnabled:false,compatibilityEnabled:false,
 nodePath:join(accountRoot,'runtime','node.exe'),helperPath:join(accountRoot,'bin','admin-native.exe'),
 workerPath:join(accountRoot,'releases',release,'cli.mjs'),actionsPath:join(accountRoot,'releases',release,'actions.ps1')};
 mkdirSync(join(accountRoot,'data'));writeFileSync(join(accountRoot,'data/config.json'),JSON.stringify(config));writeFileSync(join(accountRoot,'installation.json'),JSON.stringify(account));
 const manifest={schemaVersion:1,name:'hashi-sidecar',version:'3.0.0',state:'ready',targets:[{sid,root:'accounts/'+sid,installationId:id}],files:{}};
 for(const name of ['bin/hashi-sidecar.exe','bin/launcher.mjs','bin/accounts.mjs','runtime/node.exe','runtime/LICENSE']){
  const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'fixture');manifest.files[name]=hash('fixture');
 }
 for(const name of ['accounts/'+sid+'/installation.json','accounts/'+sid+'/data/config.json'])manifest.files[name]=hash(readFileSync(join(root,name)));
 const save=()=>writeFileSync(join(root,'sidecar.json'),JSON.stringify(manifest));save();
 return {root,accountRoot,manifest,account,config,save};
}
test('fresh Windows-only package resolves its own runtime without a legacy configuration',()=>{
 const f=fixture(),suite=loadSuite(f.root),target=selectTarget(suite,sid),installed=assertTarget(target,installation(target.path));
 assert.equal(installed.config.githubEnabled,false);assert.equal(existsSync(join(f.accountRoot,'compat')),false);
 assert.equal(installed.config.installationId,f.config.installationId);
});
test('target selection is explicit and never defaults from a folder or the only configured account',()=>{
 const f=fixture(),suite=loadSuite(f.root);
 assert.throws(()=>selectTarget(suite),{code:'SIDECAR_TARGET_REQUIRED'});
 assert.throws(()=>selectTarget(suite,'S-1-5-21-1-2-3-1002'),{code:'SIDECAR_TARGET_UNAVAILABLE'});
 for(const value of ['../elsewhere',sid+'/../other','S-1-5-18'])assert.throws(()=>selectTarget(suite,value));
});
test('target directory and protected configuration cannot substitute another identity or installation',()=>{
 const f=fixture(),target=selectTarget(loadSuite(f.root),sid),installed=installation(f.accountRoot);
 assert.throws(()=>assertTarget(target,{...installed,config:{...installed.config,userSid:'S-1-5-21-1-2-3-1002'}}),{code:'SIDECAR_TARGET_REJECTED'});
 assert.throws(()=>assertTarget(target,{...installed,config:{...installed.config,installationId:randomUUID()}}),{code:'SIDECAR_TARGET_REJECTED'});
 writeFileSync(join(f.accountRoot,'data/config.json'),JSON.stringify({...f.config,userSid:'S-1-5-21-1-2-3-1002'}));
 assert.throws(()=>loadSuite(f.root),{code:'SIDECAR_INTEGRITY_REJECTED'});
});
test('registry rejects duplicate targets, path escape and an unfinished installation',()=>{
 for(const change of [m=>m.targets.push({...m.targets[0]}),m=>m.targets[0].root='../outside',m=>m.state='incomplete']){
  const f=fixture();change(f.manifest);f.save();assert.throws(()=>loadSuite(f.root));
 }
 const f=fixture();f.manifest.files['../outside']='0'.repeat(64);f.save();assert.throws(()=>loadSuite(f.root),{code:'SIDECAR_INSTALLATION_REJECTED'});
});
test('an explicitly enabled compatibility surface still requires its complete pinned closure',()=>{
 const f=fixture();f.account.compatibility=true;writeFileSync(join(f.accountRoot,'installation.json'),JSON.stringify(f.account));
 assert.throws(()=>installation(f.accountRoot),{code:'ADMIN_INSTALLATION_REJECTED'});
});
