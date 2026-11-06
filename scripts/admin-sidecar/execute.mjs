import {readFileSync,writeFileSync,existsSync,lstatSync,readdirSync,renameSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fail,noLinks,inside,sha,redact,validateOperation,githubEndpoint} from './core.mjs';
import {maintenanceOperation} from './maintenance.mjs';
export function nativeIdentity(c){
 const p=spawnSync(c.helperPath,['identity'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
 if(p.status!==0)fail('ADMIN_IDENTITY_UNAVAILABLE');try{return JSON.parse(p.stdout);}catch{fail('ADMIN_IDENTITY_UNAVAILABLE');}
}
export function targetSession(c){
 const p=spawnSync(c.helperPath,['sessions'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
 if(p.status!==0)fail('ADMIN_USER_SESSION_UNAVAILABLE');
 let reply;try{reply=JSON.parse(p.stdout);}catch{fail('ADMIN_USER_SESSION_UNAVAILABLE');}
 const sessions=reply.sessions?.filter(s=>s.sid===c.userSid&&[0,1,4].includes(s.state))||[];
 if(!reply.complete||!sessions.length)fail('ADMIN_USER_SESSION_UNAVAILABLE');
 return sessions;
}
export function environment(c,profile){
 const env={...process.env};for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'])delete env[key];
 if(profile!=='system')Object.assign(env,{USERPROFILE:c.userProfile,APPDATA:join(c.userProfile,'AppData','Roaming'),LOCALAPPDATA:join(c.userProfile,'AppData','Local'),GH_CONFIG_DIR:join(c.userProfile,'AppData','Roaming','GitHub CLI')});
 const temporary=inside(c.root,'lanes',profile,'work','temp');mkdirSync(temporary,{recursive:true});
 Object.assign(env,{TEMP:temporary,TMP:temporary,NPM_CONFIG_CACHE:join(temporary,'cache','npm'),PIP_CACHE_DIR:join(temporary,'cache','pip'),UV_CACHE_DIR:join(temporary,'cache','uv'),GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'});return env;
}
export function runProcess(c,r,context,input){
 noLinks(input.executable);noLinks(input.cwd);
 const work=inside(c.root,'lanes',r.profile,'work',r.id);mkdirSync(work,{recursive:true});
 const payload={...input,statusFile:inside(work,'live.json'),maxOutputBytes:128*1024,cancelFile:context.cancelFile,revokedFile:context.revokedFile,deadlineMs:context.grant.expiresAt};
 const p=spawnSync(c.helperPath,['run'],{input:JSON.stringify(payload),env:environment(c,r.profile),encoding:'utf8',windowsHide:true,timeout:(input.timeoutMs||40000)+20000,maxBuffer:2*1024*1024});
 if(p.status!==0||p.error)fail('ADMIN_OUTCOME_UNCERTAIN');
 let result;try{result=JSON.parse(p.stdout);}catch{fail('ADMIN_OUTCOME_UNCERTAIN');}
 if(result.identity?.sid!==c.profiles[r.profile].sid||(c.profiles[r.profile].elevated?(!result.identity.elevated&&!result.identity.system):(result.identity.elevated||result.identity.system)))fail('ADMIN_EXECUTION_IDENTITY_REJECTED');
 if(result.termination)fail('ADMIN_OUTCOME_UNCERTAIN',{diagnostics:{...result,phase:'process_terminated'}});
 return result;
}
function fileOperation(r){
 const i=r.input,path=noLinks(i.path);
 if(r.operation==='file.list'){
 const all=readdirSync(path,{withFileTypes:true}),rows=all.slice(0,i.limit||200).map(x=>({name:x.name,directory:x.isDirectory(),link:x.isSymbolicLink()}));
 return {path,entries:rows,total:all.length,complete:rows.length===all.length};
 }
 if(r.operation==='file.read'){
 const stat=lstatSync(path);if(!stat.isFile())fail('ADMIN_FILE_REJECTED');const max=i.maxBytes||262144;if(stat.size>max)fail('ADMIN_SIZE_REJECTED');
 const bytes=readFileSync(path);if(bytes.length>max)fail('ADMIN_SIZE_REJECTED');let text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return {path,encoding:'base64',content:bytes.toString('base64'),bytes:bytes.length,sha256:sha(bytes)};}
 try{return {path,encoding:'json',content:JSON.parse(text),bytes:bytes.length,sha256:sha(bytes)};}catch{return {path,encoding:'utf8',content:text,bytes:bytes.length,sha256:sha(bytes)};}
 }
 const previous=existsSync(path)?sha(readFileSync(path)):null;if(previous!==i.expectedSha256)fail('ADMIN_STALE_STATE');
 const bytes=Buffer.from(i.content,i.encoding||'utf8'),tmp=path+'.admin-'+r.id+'.tmp';
 writeFileSync(tmp,bytes,{flag:'wx'});if((existsSync(path)?sha(readFileSync(path)):null)!==previous)fail('ADMIN_STALE_STATE');
 renameSync(tmp,path);if(sha(readFileSync(path))!==sha(bytes))fail('ADMIN_OUTCOME_UNCERTAIN');
 return {path,bytes:bytes.length,previousSha256:previous,sha256:sha(bytes),written:true,concurrency:'read-compare-rename-read'};
}
function parseHttp(text){
 const match=text.match(/^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n/);if(!match)return {status:null,headers:{},body:text};
 const end=text.search(/\r?\n\r?\n/);if(end<0)return {status:Number(match[1]),headers:{},body:''};
 const header=text.slice(0,end),separator=text.slice(end).match(/^\r?\n\r?\n/)[0];let headers={};
 for(const line of header.split(/\r?\n/).slice(1)){const at=line.indexOf(':');if(at>0){const k=line.slice(0,at).toLowerCase();if(['x-github-request-id','x-accepted-github-permissions','retry-after','link','x-ratelimit-remaining','x-ratelimit-reset'].includes(k))headers[k]=line.slice(at+1).trim();}}
 return {status:Number(match[1]),headers,body:text.slice(end+separator.length)};
}
function githubCall(c,r,ctx,method,endpoint,body){
 const args=['api','--hostname','github.com','--method',method,'--include','-H','Accept: application/vnd.github+json'];
 if(body!==undefined)args.push('--input','-');args.push(endpoint);
 const run=runProcess(c,r,ctx,{executable:c.ghPath,args,cwd:c.root,stdin:body===undefined?'':JSON.stringify(body),timeoutMs:40000});
 const http=parseHttp(run.stdout),status=http.status||Number(run.stderr?.match(/\bHTTP\s+([45]\d\d)\b/i)?.[1]);
 if(run.exitCode!==0||status>=400){
 if(method!=='GET'&&(!status||status===408||status>=500))fail('ADMIN_OUTCOME_UNCERTAIN');
 fail('ADMIN_UPSTREAM_REJECTED',{httpStatus:status,reason:status===401?'AUTHENTICATION_REQUIRED':status===403?'PERMISSION_DENIED':status===404?'NOT_FOUND':status===422?'VALIDATION_REJECTED':status===429?'RATE_LIMITED':undefined});
 }
 if(run.stdoutTruncated)fail(method==='GET'?'ADMIN_SIZE_REJECTED':'ADMIN_OUTCOME_UNCERTAIN');
 let data;try{data=JSON.parse(http.body);}catch{data=http.body;}
 return {status:status||200,headers:http.headers,data,complete:!http.headers.link};
}
export function executeOperation(c,r,ctx,{identity=()=>nativeIdentity(c)}={}){
 validateOperation(r);if(r.operation==='identity')return identity();
 if(r.operation.startsWith('acl.')||['file.probe','process.inspect','process.stop'].includes(r.operation))return maintenanceOperation(c,r,ctx);
 if(r.operation.startsWith('file.'))return fileOperation(r);
 if(r.operation==='process.run')return runProcess(c,r,ctx,r.input);
 if(r.operation==='script.run'){
 const folder=inside(c.root,'lanes',r.profile,'work',r.id);mkdirSync(folder,{recursive:false});
 const script=inside(folder,r.input.interpreter==='powershell'?'script.ps1':'script.mjs');writeFileSync(script,r.input.script,{flag:'wx'});
 if(sha(readFileSync(script))!==r.input.sha256)fail('ADMIN_ARTIFACT_CHANGED');
 const executable=r.input.interpreter==='powershell'?c.powershellPath:c.nodePath;
 const prefix=r.input.interpreter==='powershell'?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script]:[script];
 return runProcess(c,r,ctx,{executable,args:[...prefix,...r.input.args],cwd:r.input.cwd,window:r.input.window,timeoutMs:r.input.timeoutMs||40000});
 }
 if(r.operation.startsWith('github.')){
 if(c.githubEnabled===false)fail('ADMIN_GITHUB_UNAVAILABLE');
 const account=githubCall(c,r,ctx,'GET','user');
 if(account.data?.login?.toLowerCase()!==c.expectedGitHubLogin.toLowerCase())fail('ADMIN_GITHUB_ACCOUNT_MISMATCH');
 if(r.operation==='github.graphql'){
 const answer=githubCall(c,r,ctx,'POST','graphql',{query:r.input.query,variables:r.input.variables||{}});
 if(answer.data?.errors?.length)fail('ADMIN_OUTCOME_UNCERTAIN');
 return answer;
 }
 return githubCall(c,r,ctx,r.input.method,githubEndpoint(r.input.path),r.input.body);
 }
 const run=runProcess(c,r,ctx,{executable:c.powershellPath,args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',c.actionsPath,'-Operation',r.operation],cwd:c.root,stdin:JSON.stringify(r.input),timeoutMs:60000});
 let result;try{result=JSON.parse(run.stdout.replace(/^\uFEFF/,''));}catch{fail(r.operation.endsWith('.read')||r.operation.endsWith('.query')?'ADMIN_OPERATION_REJECTED':'ADMIN_OUTCOME_UNCERTAIN');}
 if(!result.ok)fail(/^ADMIN_[A-Z_]+$/.test(result.error?.code||'')?result.error.code:'ADMIN_OPERATION_FAILED',{diagnostics:result.data});
 return result.data;
}
