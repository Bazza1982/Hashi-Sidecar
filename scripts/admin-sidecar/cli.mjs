import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fail,inside,readJSON,atomic,validateConfig,createGrant,revokeGrant,enqueue,processQueue,resultFor,operations,profiles,publicError} from './core.mjs';
import {nativeIdentity,executeOperation,targetSession} from './execute.mjs';
export function parseArgs(argv){
 const cmd=argv.shift()||'help',out={command:cmd};
 if(cmd==='--help'||cmd==='-h')return {command:'help'};
 const allowed={help:[],version:[],status:[],capabilities:[],'grant-create':['input-file'],'grant-revoke':['grant'],
 'grant-inspect':['grant'],call:['grant','profile','operation','input-file','request-id'],submit:['grant','profile','operation','input-file','request-id'],
 result:['request-id'],cancel:['request-id'],events:['request-id'],reconcile:['request-id'],'legacy-result':['request-id']};
 if(!Object.hasOwn(allowed,cmd))fail('ADMIN_ARGUMENT_REJECTED');
 for(let n=0;n<argv.length;n+=2){const key=argv[n],value=argv[n+1];if(!key.startsWith('--')||!allowed[cmd].includes(key.slice(2))||!value||value.startsWith('--')||Object.hasOwn(out,key.slice(2)))fail('ADMIN_ARGUMENT_REJECTED');out[key.slice(2)]=value;}
 const required={'grant-create':['input-file'],'grant-revoke':['grant'],'grant-inspect':['grant'],call:['grant','profile','operation'],submit:['grant','profile','operation'],
 result:['request-id'],cancel:['request-id'],events:['request-id'],reconcile:['request-id'],'legacy-result':['request-id']};
 if((required[cmd]||[]).some(k=>!out[k]))fail('ADMIN_ARGUMENT_REJECTED');return out;
}
export function claimState(reply,{persisted=false,running=false}={}){
 if(persisted||reply.error?.code!=='ADMIN_OUTCOME_UNCERTAIN')return 'finished';
 return running?'wait':'uncertain';
}
export function settledReply(read,persisted){
 const first=read();
 return ['ADMIN_PENDING','ADMIN_OUTCOME_UNCERTAIN'].includes(first.error?.code)&&persisted()?read():first;
}
export async function waitForReply({read,persisted,state,dispatch,wait=delay,now=()=>Date.now(),deadline,orphanGraceMs=3000}){
 let nextDispatch=0,orphanSince=null;
 while(now()<deadline){
  const reply=settledReply(read,persisted);
  if(!['ADMIN_PENDING','ADMIN_OUTCOME_UNCERTAIN'].includes(reply.error?.code)||persisted())return settledReply(read,persisted);
  if(reply.error?.code==='ADMIN_OUTCOME_UNCERTAIN'){
   const observed=state();
   const latest=settledReply(read,persisted);
   if(persisted()||!['ADMIN_PENDING','ADMIN_OUTCOME_UNCERTAIN'].includes(latest.error?.code))return latest;
   if(observed==='Running')orphanSince=null;
   else if(orphanSince===null)orphanSince=now();
   else if(now()-orphanSince>=orphanGraceMs)return settledReply(read,persisted);
  }else if(now()>=nextDispatch){
   const observed=state(),latest=settledReply(read,persisted);
   if(latest.error?.code==='ADMIN_PENDING'&&!persisted()&&observed!=='Running')dispatch();
   nextDispatch=now()+4000;
  }
  await wait(200);
 }
 fail('ADMIN_RESPONSE_TIMEOUT');
}
function task(c,name,query=false){
 if(!/^Hashi(?:Admin|Sidecar|HubV2-GitHubRead)-[a-zA-Z0-9-]+$/.test(name))fail('ADMIN_CONFIG_REJECTED');
 const code=query?
 "$t=Get-ScheduledTask -TaskPath '\\' -TaskName '"+name+"';$i=Get-ScheduledTaskInfo -TaskPath '\\' -TaskName '"+name+"';@{state=[string]$t.State;lastResult=$i.LastTaskResult;logon=[string]$t.Principal.LogonType;runLevel=[string]$t.Principal.RunLevel}|ConvertTo-Json -Compress":
 "Start-ScheduledTask -TaskPath '\\' -TaskName '"+name+"'";
 const p=spawnSync(c.powershellPath,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:65536});
 if(p.status!==0)fail('ADMIN_TASK_UNAVAILABLE');return query?JSON.parse(p.stdout):null;
}
function publisher(c,who){if(!c.publisherSids.includes(who.sid)||(!who.system&&!who.elevated))fail('ADMIN_PUBLISHER_REJECTED');}
async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 const {installation}=await import(pathToFileURL(join(root,'bin','launcher.mjs')).href),installed=installation(root),c=validateConfig(installed.config);
 if(process.argv[2]==='--worker'){
 if(process.argv.length!==5||process.argv[3]!=='--profile'||!profiles.includes(process.argv[4]))fail('ADMIN_ARGUMENT_REJECTED');
 const profile=process.argv[4],who=nativeIdentity(c);
 const count=await processQueue(c,profile,{identity:who,execute:(r,ctx)=>executeOperation(c,r,ctx)});
 console.log(JSON.stringify({ok:true,processed:count,profile}));return;
 }
 const args=parseArgs(process.argv.slice(2));
 if(args.command==='help'){
 console.log('HASHI Admin Sidecar '+installed.manifest.version+'\nCommands: status, capabilities, version\n'+
 'grant-create --input-file ABSOLUTE_JSON; grant-inspect/grant-revoke --grant UUID\n'+
 'call/submit --grant UUID --profile system|user|user-admin --operation OP [--input-file ABSOLUTE_JSON] [--request-id UUID]\n'+
 'result/cancel/events/reconcile --request-id UUID; legacy-result --request-id UUID\n'+
 'Legacy GitHub commands (account, main, push, pr-view, pr-edit, etc.) retain their existing syntax.\n'+
 'Use managed execution. Grants bind trusted Windows publisher principals; Agent/task labels are audit metadata, not separately attested identities.');return;
 }
 if(args.command==='version'){console.log(JSON.stringify({name:installed.manifest.name,version:installed.manifest.version,releaseId:installed.manifest.releaseId}));return;}
 const who=nativeIdentity(c);
 if(args.command==='status'||args.command==='capabilities'){
 const tasks=Object.fromEntries(profiles.map(p=>{if(c.profiles[p].available===false)return[p,{available:false,reason:c.profiles[p].reason}];try{return [p,{available:true,...task(c,c.profiles[p].taskName,true),...(p==='system'?{}:{sessions:targetSession(c)})}];}catch(e){return[p,{available:false,error:publicError(e)}];}}));
 console.log(JSON.stringify({ok:true,version:installed.manifest.version,releaseId:installed.manifest.releaseId,identity:who,profiles:tasks,operations,
 callerBinding:'verified Windows publisher SID',agentBinding:'audit labels only; no per-Agent attestation',
 authorization:'protected reusable task grant; optional typed path roots; explicit full-code capability for arbitrary administrator execution',
 maintenance:{aclPlans:true,conditionalRollback:true,credentialContentExport:false,processPidGuards:true,maxExecutionMs:86400000},
 targetSid:c.userSid,
 github:{available:c.githubEnabled!==false,host:'github.com',expectedLogin:c.expectedGitHubLogin,scope:'full authenticated account API rights, subject to actual GitHub token/role permissions'},
 legacy:c.compatibilityEnabled===false?{available:false}:{available:true,entry:join(root,'compat'),operations:(await import(pathToFileURL(join(root,'compat','github-user-sidecar.mjs')).href)).supportedOperations()},requiresLoggedOnUser:'user and user-admin only'},null,2));return;
 }
 publisher(c,who);
 if(args.command==='grant-create'){
 if(!isAbsolute(args['input-file']))fail('ADMIN_ARGUMENT_REJECTED');const g=createGrant(c,readJSON(args['input-file'],65536),who);console.log(JSON.stringify({ok:true,grant:g},null,2));return;
 }
 if(args.command==='grant-revoke'){console.log(JSON.stringify({ok:true,data:revokeGrant(c,args.grant,who)}));return;}
 if(args.command==='grant-inspect'){const g=readJSON(inside(c.root,'grants',args.grant+'.json'),65536);console.log(JSON.stringify({ok:true,grant:g,revoked:existsSync(inside(c.root,'revoked',args.grant+'.json'))},null,2));return;}
 if(args.command==='legacy-result'){
 if(c.compatibilityEnabled===false)fail('ADMIN_GITHUB_UNAVAILABLE');
 const p=spawnSync(c.nodePath,[join(root,'compat','github-user-sidecar.mjs'),'--config',join(c.root,'legacy','config.json'),'--operation','result','--request-id',args['request-id']],{stdio:'inherit',windowsHide:true});process.exitCode=p.status??2;return;
 }
 if(['result','events','reconcile','cancel'].includes(args.command)){
 const answer=resultFor(c,args['request-id']),env=readJSON(inside(c.root,'requests',args['request-id']+'.json'));
 if(env.publisherSid!==who.sid&&!c.issuerSids.includes(who.sid))fail('ADMIN_PUBLISHER_REJECTED');
 if(args.command==='cancel'){atomic(inside(c.root,'lanes',env.profile,'cancel',env.id+'.json'),{requestedAt:new Date().toISOString(),requestedBy:who.sid});console.log(JSON.stringify({ok:true,cancelRequested:true,id:env.id,completed:existsSync(inside(c.root,'lanes',env.profile,'responses',env.id+'.json'))}));return;}
 if(args.command==='events'){console.log(JSON.stringify({id:env.id,submittedAt:new Date(env.issuedAt).toISOString(),claimed:existsSync(inside(c.root,'lanes',env.profile,'claims',env.id+'.json')),result:answer,execution:(()=>{const p=inside(c.root,'lanes',env.profile,'work',env.id,'live.json');try{return existsSync(p)?readJSON(p):null;}catch{return {available:false};}})()},null,2));return;}
 console.log(JSON.stringify(args.command==='reconcile'?{...answer,reconciliation:{automaticReplay:false,required:answer.error?.code==='ADMIN_OUTCOME_UNCERTAIN',next:'Inspect the actual target with a separate read operation; preserve the original claim and result.'}}:answer,null,2));if(!answer.ok)process.exitCode=1;return;
 }
 const id=args['request-id']||randomUUID(),input=args['input-file']?(isAbsolute(args['input-file'])?readJSON(args['input-file']):fail('ADMIN_ARGUMENT_REJECTED')):{};
 const r={id,grantId:args.grant,profile:args.profile,operation:args.operation,input};
 if(c.profiles[r.profile]?.available===false)fail('ADMIN_PROFILE_UNAVAILABLE');
 if(r.profile!=='system'&&!existsSync(inside(c.root,'requests',id+'.json')))targetSession(c);
 enqueue(c,r,{identity:who});
 const response=inside(c.root,'lanes',r.profile,'responses',id+'.json');
 const read=()=>resultFor(c,id),persisted=()=>existsSync(response),cached=settledReply(read,persisted);
 const finish=answer=>{console.log(JSON.stringify(answer,null,2));if(!answer.ok||(answer.data?.exitCode!==undefined&&answer.data.exitCode!==0))process.exitCode=1;};
 if(!['ADMIN_PENDING','ADMIN_OUTCOME_UNCERTAIN'].includes(cached.error?.code)||persisted()){finish(settledReply(read,persisted));return;}
 console.error(JSON.stringify({id,phase:cached.error?.code==='ADMIN_PENDING'?'submitted':'claimed',profile:r.profile,operation:r.operation}));
 if(args.command==='submit'){
  const current=task(c,c.profiles[r.profile].taskName,true),latest=settledReply(read,persisted);
  if(!['ADMIN_PENDING','ADMIN_OUTCOME_UNCERTAIN'].includes(latest.error?.code)||persisted()){finish(latest);return;}
  if(latest.error?.code==='ADMIN_PENDING'&&current.state!=='Running')task(c,c.profiles[r.profile].taskName);
  console.log(JSON.stringify({ok:true,id,submitted:true,profile:r.profile,automaticReplay:false}));return;
 }
 const deadline=Date.now()+Math.min(340000,(input.timeoutMs||60000)+30000);
 const answer=await waitForReply({read,persisted,state:()=>task(c,c.profiles[r.profile].taskName,true).state,
 dispatch:()=>task(c,c.profiles[r.profile].taskName),deadline});
 finish(answer);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(JSON.stringify({ok:false,error:publicError(e)}));process.exitCode=2;});
