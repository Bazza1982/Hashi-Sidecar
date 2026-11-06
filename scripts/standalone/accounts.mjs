import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep,join} from 'node:path';
import {createHash} from 'node:crypto';
const sidPattern=/^S-1-5-21-(?:\d+-){2,}\d+$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function reject(code){throw Object.assign(new Error(code),{code});}
export function localPath(root,part){
 if(typeof part!=='string'||isAbsolute(part)||/^[a-z]:/i.test(part))reject('SIDECAR_INSTALLATION_REJECTED');
 const path=resolve(root,part),rel=relative(resolve(root),path);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))reject('SIDECAR_INSTALLATION_REJECTED');
 for(let p=path;;p=dirname(p)){if(existsSync(p)&&lstatSync(p).isSymbolicLink())reject('SIDECAR_INSTALLATION_REJECTED');if(dirname(p)===p)break;}
 return path;
}
export function loadSuite(root){
 root=resolve(root);
 const manifest=JSON.parse(readFileSync(join(root,'sidecar.json'),'utf8').replace(/^\uFEFF/,''));
 if(manifest.schemaVersion!==1||manifest.name!=='hashi-sidecar'||manifest.version!=='3.0.0'||manifest.state!=='ready'||
 !Array.isArray(manifest.targets)||!manifest.targets.length||!manifest.files||typeof manifest.files!=='object')reject('SIDECAR_INSTALLATION_REJECTED');
 const seen=new Set();
 for(const t of manifest.targets){
  if(!sidPattern.test(t.sid||'')||seen.has(t.sid)||t.root!=='accounts/'+t.sid||!uuid.test(t.installationId||''))reject('SIDECAR_TARGET_REJECTED');
  seen.add(t.sid);localPath(root,t.root);
  for(const name of [t.root+'/installation.json',t.root+'/data/config.json'])if(!Object.hasOwn(manifest.files,name))reject('SIDECAR_INSTALLATION_REJECTED');
 }
 for(const name of ['bin/hashi-sidecar.exe','bin/launcher.mjs','bin/accounts.mjs','runtime/node.exe','runtime/LICENSE'])if(!Object.hasOwn(manifest.files,name))reject('SIDECAR_INSTALLATION_REJECTED');
 for(const [name,pin] of Object.entries(manifest.files)){
  if(!/^[a-f0-9]{64}$/.test(pin)||createHash('sha256').update(readFileSync(localPath(root,name))).digest('hex')!==pin)reject('SIDECAR_INTEGRITY_REJECTED');
 }
 return {root,manifest};
}
export function selectTarget(suite,sid){
 if(!sidPattern.test(sid||''))reject('SIDECAR_TARGET_REQUIRED');
 const target=suite.manifest.targets.find(t=>t.sid===sid);
 if(!target)reject('SIDECAR_TARGET_UNAVAILABLE');
 return {...target,path:localPath(suite.root,target.root)};
}
export function assertTarget(target,installed){
 if(installed.config.userSid!==target.sid||installed.config.installationId!==target.installationId)reject('SIDECAR_TARGET_REJECTED');
 return installed;
}
