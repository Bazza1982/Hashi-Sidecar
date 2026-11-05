import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const fail=code=>{throw Object.assign(new Error(code),{code});};
function safe(root,part){if(typeof part!=='string'||isAbsolute(part)||/^[a-z]:/i.test(part))fail('ADMIN_INSTALLATION_REJECTED');const p=resolve(root,part),r=relative(root,p);if(r==='..'||r.startsWith('..'+sep))fail('ADMIN_INSTALLATION_REJECTED');return p;}
export function installation(root){
 root=resolve(root);const manifest=JSON.parse(readFileSync(join(root,'installation.json'),'utf8').replace(/^\uFEFF/,''));
 if(manifest.schemaVersion!==2||manifest.name!=='hashi-admin-sidecar'||!/^[23]\.\d+\.\d+$/.test(manifest.version||'')||
 !new RegExp('^'+manifest.version.replaceAll('.','\\.')+'-[a-f0-9]{12}$').test(manifest.releaseId||'')||manifest.config!=='data/config.json')fail('ADMIN_INSTALLATION_REJECTED');
 for(const [name,pin]of Object.entries(manifest.files||{})){const p=safe(root,name);if(!/^[a-f0-9]{64}$/.test(pin)||createHash('sha256').update(readFileSync(p)).digest('hex')!==pin)fail('ADMIN_INTEGRITY_REJECTED');}
 const config=JSON.parse(readFileSync(safe(root,manifest.config),'utf8').replace(/^\uFEFF/,''));
 const expected={root:join(root,'data'),nodePath:join(root,'runtime','node.exe'),helperPath:join(root,'bin','admin-native.exe'),
 workerPath:join(root,'releases',manifest.releaseId,'cli.mjs'),actionsPath:join(root,'releases',manifest.releaseId,'actions.ps1')};
 for(const[k,v]of Object.entries(expected))if(resolve(config[k]||'').toLowerCase()!==resolve(v).toLowerCase())fail('ADMIN_INSTALLATION_REJECTED');
 const required=['bin/launcher.mjs','bin/hashi-admin.exe','bin/admin-native.exe','runtime/node.exe','runtime/LICENSE',
 ...['cli.mjs','core.mjs','execute.mjs','actions.ps1'].map(p=>'releases/'+manifest.releaseId+'/'+p)];
 if(manifest.compatibility!==false)required.push('compat/github-user-sidecar.mjs','compat/launcher.mjs');
 if(manifest.version!=='2.0.0')required.push('bin/maintenance-native.exe','releases/'+manifest.releaseId+'/maintenance.mjs');
 if(required.some(p=>!Object.hasOwn(manifest.files,p)))fail('ADMIN_INSTALLATION_REJECTED');
 return {root,manifest,config};
}
async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),i=installation(root),args=process.argv.slice(2);
 if(args.some(x=>['--worker','--config','--root'].includes(x)))fail('ADMIN_ARGUMENT_REJECTED');
 if(resolve(process.execPath).toLowerCase()!==resolve(i.config.nodePath).toLowerCase())fail('ADMIN_RUNTIME_REJECTED');
 if(i.manifest.compatibility===false){
 const p=spawnSync(i.config.nodePath,[i.config.workerPath,...args],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=p.status??2;return;
 }
 const legacy=await import(pathToFileURL(join(root,'compat','launcher.mjs')).href);
 const oldNames=(await import(pathToFileURL(join(root,'compat','github-user-sidecar.mjs')).href)).supportedOperations();
 const first=args[0]==='--operation'?args[1]:args[0];let argv,legacyResult=false;
 if(first==='result'){
 const parsed=legacy.operationArguments(args),at=parsed.argv.indexOf('--request-id'),id=parsed.argv[at+1];
 legacyResult=existsSync(join(root,'data','legacy','requests',id+'.json'))&&!existsSync(join(root,'data','requests',id+'.json'));
 }
 if(oldNames.includes(first)&&(first!=='result'||legacyResult||args[0]==='--operation')){
 const op=legacy.operationArguments(args);
 argv=[join(root,'compat','github-user-sidecar.mjs'),'--config',join(root,'data','legacy','config.json'),...op.argv];
 }else argv=[i.config.workerPath,...args];
 const p=spawnSync(i.config.nodePath,argv,{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=p.status??2;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(JSON.stringify({ok:false,error:{code:/^ADMIN_[A-Z_]+$/.test(e?.code||'')?e.code:'ADMIN_UNAVAILABLE'}}));process.exitCode=2;});
