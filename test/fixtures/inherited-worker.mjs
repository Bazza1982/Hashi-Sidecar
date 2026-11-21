import {readFileSync,writeFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function run(settingsFile){
 const c=JSON.parse(readFileSync(settingsFile,'utf8'));
 const identity=JSON.parse(execFileSync(c.helper,['identity'],{encoding:'utf8',windowsHide:true}));
 const protectedDirectory=join(dirname(c.helper),'../data/lanes',identity.system?'system':'user-admin','work');
 const privilegedPath=identity.elevated?join(protectedDirectory,'inherited-'+c.stream+'.log'):'';
 let protectedWriteDenied=false;
 if(!identity.elevated){try{writeFileSync(join(protectedDirectory,'inherited-denied-'+c.stream),'must be denied');}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e;protectedWriteDenied=true;}}
 execFileSync(c.windowHelper,[String(process.pid),join(c.directory,'window.json')],{windowsHide:true});
 const child=spawn(process.execPath,[fileURLToPath(new URL('./worker-stop-probe.mjs',import.meta.url)),c.directory,c.profile+'-child',c.helper,privilegedPath],{windowsHide:true,detached:true,stdio:['ignore',c.stream==='stdout'?'inherit':'ignore',c.stream==='stderr'?'inherit':'ignore','ipc']});
 writeFileSync(join(c.directory,'parent.json'),JSON.stringify({pid:process.pid,descendant:child.pid,identity,privilegedPath,protectedWriteDenied}));
 process.stdout.write('ordinary 中文 stdout\n');process.stderr.write('ordinary 中文 stderr\n');
 child.once('message',()=>process.exit(37));
}
