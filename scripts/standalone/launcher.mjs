import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadSuite,selectTarget,assertTarget,reject} from './accounts.mjs';
async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),suite=loadSuite(root),args=process.argv.slice(2);
 if(resolve(process.execPath).toLowerCase()!==resolve(join(root,'runtime','node.exe')).toLowerCase())reject('SIDECAR_RUNTIME_REJECTED');
 if(args.length===0||(args.length===1&&['--help','help'].includes(args[0]))){
  console.log('HASHI Sidecar 3.0.0\nCommands: version, targets\n--target-sid SID status|capabilities|grant-create|grant-inspect|grant-revoke|call|submit|result|events|cancel|reconcile\nEach target has independent grants and results. Use the same target SID to retrieve a request.');return;
 }
 if(args.length===1&&args[0]==='version'){console.log(JSON.stringify({name:suite.manifest.name,version:suite.manifest.version,targets:suite.manifest.targets.length}));return;}
 if(args.length===1&&args[0]==='targets'){console.log(JSON.stringify({ok:true,targets:suite.manifest.targets.map(({sid})=>({sid}))},null,2));return;}
 if(args[0]!=='--target-sid'||args.length<3||args.slice(2).includes('--target-sid'))reject('SIDECAR_TARGET_REQUIRED');
 const target=selectTarget(suite,args[1]);
 const child=await import(pathToFileURL(join(target.path,'bin','launcher.mjs')).href);
 assertTarget(target,child.installation(target.path));
 const p=spawnSync(join(target.path,'bin','hashi-admin.exe'),args.slice(2),{cwd:target.path,stdio:'inherit',windowsHide:true});
 if(p.error)reject('SIDECAR_EXECUTION_UNAVAILABLE');process.exitCode=p.status??2;
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:{code:/^(SIDECAR|ADMIN)_[A-Z_]+$/.test(e?.code||'')?e.code:'SIDECAR_UNAVAILABLE'}}));process.exitCode=2;});
