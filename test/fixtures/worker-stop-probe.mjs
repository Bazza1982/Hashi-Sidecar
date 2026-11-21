import {appendFileSync,writeFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
const [root,mode,helper,privilegedFile]=process.argv.slice(2);
const path=join(root,mode);
if(mode.endsWith('-child')){
 writeFileSync(path+'.json',JSON.stringify({pid:process.pid,ppid:process.ppid}));
 let ready=false;
 const timer=setInterval(()=>{
  appendFileSync(path+'.effects','operation\n');
  if(privilegedFile)appendFileSync(privilegedFile,'privileged-operation\n');
  if(!ready&&process.send){ready=true;process.send('ready');process.disconnect();}
 },100);
 setTimeout(()=>{clearInterval(timer);process.exit(0);},25000);
}else{
 const identity=JSON.parse(execFileSync(helper,['identity'],{encoding:'utf8',windowsHide:true}));
 const protectedDirectory=join(dirname(helper),'../data/lanes',identity.system?'system':'user-admin','work');
 const privilegedPath=identity.elevated?join(protectedDirectory,'stop-effects.log'):'';
 let protectedWriteDenied=false;
 if(!identity.elevated){
  try{writeFileSync(join(protectedDirectory,'limited-write-probe'), 'must be denied');}
  catch(error){if(error.code!=='EACCES'&&error.code!=='EPERM')throw error;protectedWriteDenied=true;}
 }
 appendFileSync(path+'.starts','start\n');
 writeFileSync(path+'.json',JSON.stringify({pid:process.pid,ppid:process.ppid,identity,privilegedPath,protectedWriteDenied}));
 const child=spawn(process.execPath,[import.meta.filename,root,mode+'-child',helper,privilegedPath],{windowsHide:true,stdio:'ignore'});
 setTimeout(()=>process.exit(0),25000);
 child.on('error',()=>process.exit(91));
}
