import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute,relative,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
export const operations=Object.freeze(['identity','process.run','script.run','file.read','file.write','file.list','github.request','github.graphql','service.query','service.control','registry.read','registry.write','task.query','task.control','task.restart','acl.inspect','acl.plan','acl.apply','acl.restore','file.probe','process.inspect','process.stop']);
export const profiles=Object.freeze(['system','user','user-admin']);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sid=/^S-1-(?:\d+-)*\d+$/;
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function fail(code,fields={}){throw Object.assign(new Error(code),{code,...fields});}
export function noLinks(path){
 let p=resolve(path);for(;;){if(existsSync(p)&&lstatSync(p).isSymbolicLink())fail('ADMIN_PATH_REJECTED');const parent=dirname(p);if(parent===p)break;p=parent;}return resolve(path);
}
export function inside(root,...parts){const path=resolve(root,...parts),rel=relative(resolve(root),path);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))fail('ADMIN_PATH_REJECTED');return noLinks(path);}
export function readJSON(path,max=4*1024*1024){noLinks(path);const b=readFileSync(path);if(b.length>max)fail('ADMIN_SIZE_REJECTED');return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));}
export function atomic(path,value){noLinks(path);const tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value)+'\n',{flag:'wx'});renameSync(tmp,path);}
export function validateConfig(c){
 if(!c||c.schemaVersion!==2||!uuid.test(c.installationId||'')||!isAbsolute(c.root||'')||typeof c.machine!=='string'||!c.machine||
 !/^S-1-5-21-(?:\d+-){2,}\d+$/.test(c.userSid||'')||!Array.isArray(c.publisherSids)||!c.publisherSids.length||!Array.isArray(c.issuerSids)||
 [...c.publisherSids,...c.issuerSids].some(x=>!sid.test(x)))fail('ADMIN_CONFIG_REJECTED');
 for(const p of profiles){const v=c.profiles?.[p];if(!v||v.sid!==(p==='system'?'S-1-5-18':c.userSid)||v.elevated!==(p!=='user')||(v.available!==undefined&&typeof v.available!=='boolean'))fail('ADMIN_CONFIG_REJECTED');}
 if(c.githubEnabled!==undefined&&typeof c.githubEnabled!=='boolean')fail('ADMIN_CONFIG_REJECTED');
 if(c.compatibilityEnabled!==undefined&&typeof c.compatibilityEnabled!=='boolean')fail('ADMIN_CONFIG_REJECTED');
 if(c.githubEnabled===true&&(!path(c.ghPath)||!text(c.expectedGitHubLogin,256)||!c.expectedGitHubLogin))fail('ADMIN_CONFIG_REJECTED');
 if(c.profiles.system.available===false)fail('ADMIN_CONFIG_REJECTED');
 noLinks(c.root);return c;
}
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('ADMIN_INPUT_REJECTED');}
function text(s,max=65536){return typeof s==='string'&&!s.includes('\0')&&Buffer.byteLength(s)<=max;}
function path(s){return text(s,32767)&&isAbsolute(s);}
function argv(a){return Array.isArray(a)&&a.length<=256&&a.every(s=>text(s,32767))&&Buffer.byteLength(JSON.stringify(a))<=128*1024;}
function timeout(i){return i.timeoutMs===undefined||(Number.isSafeInteger(i.timeoutMs)&&i.timeoutMs>=100&&i.timeoutMs<=86400000);}
export function githubEndpoint(value){
 if(!text(value,4096)||!value.startsWith('/')||value.startsWith('//')||/[\\#\r\n]/.test(value))fail('ADMIN_GITHUB_ENDPOINT_REJECTED');
 let decoded;try{decoded=decodeURIComponent(value.split('?')[0]);}catch{fail('ADMIN_GITHUB_ENDPOINT_REJECTED');}
 if(decoded.includes('\\')||decoded.split('/').some(p=>p==='.'||p==='..')||decoded.startsWith('//'))fail('ADMIN_GITHUB_ENDPOINT_REJECTED');
 const url=new URL(value,'https://api.github.com');if(url.origin!=='https://api.github.com'||url.username||url.password)fail('ADMIN_GITHUB_ENDPOINT_REJECTED');
 return url.pathname.slice(1)+url.search;
}
function processGuard(i){return i&&Number.isSafeInteger(i.pid)&&i.pid>4&&/^\d{15,20}$/.test(i.expectedCreationTicks||'')&&path(i.expectedExecutable);}
export function validateOperation(r){
 if(!r||!operations.includes(r.operation))fail('ADMIN_OPERATION_REJECTED');const i=r.input;
 if(r.profile!==undefined&&!profiles.includes(r.profile))fail('ADMIN_PROFILE_REJECTED');
 if(r.operation==='identity'){keys(i,[]);return r;}
 if(r.operation==='process.run'){keys(i,['executable','args','cwd','stdin','timeoutMs','window']);
 if(!path(i.executable)||!argv(i.args)||!path(i.cwd)||!timeout(i)||(i.stdin!==undefined&&!text(i.stdin,1024*1024)))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='script.run'){keys(i,['interpreter','script','sha256','args','cwd','timeoutMs','window']);
 if(!['powershell','node'].includes(i.interpreter)||!text(i.script,1024*1024)||sha(i.script)!==i.sha256||!argv(i.args)||!path(i.cwd)||!timeout(i))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='acl.inspect'){keys(i,['path']);if(!path(i.path))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='acl.plan'){keys(i,['path','changes']);
 if(!path(i.path)||!Array.isArray(i.changes)||i.changes.length<1||i.changes.length>64)fail('ADMIN_INPUT_REJECTED');
 for(const v of i.changes){keys(v,['action','sid','rights','access']);if(!['grant','remove'].includes(v.action)||!sid.test(v.sid||'')||
 !['Read','ReadAndExecute','Modify','FullControl'].includes(v.rights)||!['Allow','Deny',undefined].includes(v.access))fail('ADMIN_INPUT_REJECTED');}}
 if(['acl.apply','acl.restore'].includes(r.operation)){keys(i,['path','planId']);if(!path(i.path)||!uuid.test(i.planId||''))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='file.probe'){keys(i,['path','maxBytes']);if(!path(i.path)||(i.maxBytes!==undefined&&(!Number.isSafeInteger(i.maxBytes)||i.maxBytes<1||i.maxBytes>16*1024*1024)))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='process.inspect'){keys(i,['pid']);if(!Number.isSafeInteger(i.pid)||i.pid<=4)fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='process.stop'){keys(i,['pid','expectedCreationTicks','expectedExecutable','timeoutMs']);if(!processGuard(i)||!timeout(i)||(i.timeoutMs!==undefined&&i.timeoutMs>60000))fail('ADMIN_INPUT_REJECTED');}
 if(['process.run','script.run'].includes(r.operation)){
 if(!['hidden','normal',undefined].includes(i.window))fail('ADMIN_INPUT_REJECTED');
 if(i.window==='normal'&&r.profile==='system')fail('ADMIN_PROFILE_REJECTED');
 }
 if(r.operation==='file.read'){keys(i,['path','maxBytes']);if(!path(i.path)||(i.maxBytes!==undefined&&(!Number.isSafeInteger(i.maxBytes)||i.maxBytes<1||i.maxBytes>1024*1024)))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='file.list'){keys(i,['path','limit']);if(!path(i.path)||(i.limit!==undefined&&(!Number.isSafeInteger(i.limit)||i.limit<1||i.limit>1000)))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='file.write'){keys(i,['path','content','encoding','expectedSha256']);
 if(!path(i.path)||!text(i.content,2*1024*1024)||!['utf8','base64',undefined].includes(i.encoding)||
 !(i.expectedSha256===null||/^[a-f0-9]{64}$/.test(i.expectedSha256||'')))fail('ADMIN_INPUT_REJECTED');
 if(i.encoding==='base64'&&Buffer.from(i.content,'base64').toString('base64')!==i.content)fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='github.request'){keys(i,['method','path','body']);if(!['GET','POST','PUT','PATCH','DELETE'].includes(i.method))fail('ADMIN_INPUT_REJECTED');githubEndpoint(i.path);if(i.body!==undefined&&(!i.body||typeof i.body!=='object'||Buffer.byteLength(JSON.stringify(i.body))>1024*1024))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation==='github.graphql'){keys(i,['query','variables']);if(!text(i.query,128*1024)||!i.query.trim()||(i.variables!==undefined&&(!i.variables||typeof i.variables!=='object'||Buffer.byteLength(JSON.stringify(i.variables))>1024*1024)))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation.startsWith('service.')){keys(i,r.operation==='service.query'?['name']:['name','action','expectedStatus']);
 if(!/^[A-Za-z0-9_.-]{1,200}$/.test(i.name||'')||(r.operation==='service.control'&&(!['start','stop','restart'].includes(i.action)||!['Running','Stopped','Paused'].includes(i.expectedStatus))))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation.startsWith('registry.')){keys(i,r.operation==='registry.read'?['hive','key','name']:['hive','key','name','kind','value']);
 if(!['HKCU','HKLM'].includes(i.hive)||!text(i.key,2048)||!i.key||i.key.split('\\').some(x=>!x||x==='..')||!text(i.name,256)||
 (r.operation==='registry.write'&&(!['String','ExpandString','DWord','QWord','MultiString','Binary'].includes(i.kind)||i.value===undefined||Buffer.byteLength(JSON.stringify(i.value))>65536)))fail('ADMIN_INPUT_REJECTED');}
 if(r.operation.startsWith('task.')){keys(i,r.operation==='task.query'?['name','folder']:(r.operation==='task.restart'?['name','folder','expectedState','processGuards','timeoutMs']:['name','folder','action','expectedState']));
 if(!text(i.name,238)||!i.name||/[\\/*?\[\]]/.test(i.name)||!text(i.folder,238)||/[\*?\[\]]/.test(i.folder)||!i.folder.startsWith('\\')||!i.folder.endsWith('\\')||i.folder.split('\\').some(p=>p==='..')||
 (r.operation==='task.control'&&(!['run','stop','enable','disable'].includes(i.action)||!['Ready','Running','Disabled','Queued'].includes(i.expectedState)))||
 (r.operation==='task.restart'&&(!['Ready','Running'].includes(i.expectedState)||!timeout(i)||(i.timeoutMs!==undefined&&i.timeoutMs>60000)||
 (i.processGuards!==undefined&&(!Array.isArray(i.processGuards)||i.processGuards.length>64||i.processGuards.some(v=>!processGuard(v)||Object.keys(v).some(k=>!['pid','expectedCreationTicks','expectedExecutable'].includes(k))))))))fail('ADMIN_INPUT_REJECTED');}
 return r;
}
function capability(r){const family=r.operation.split('.')[0];if(r.operation==='identity')return 'identity';return family;}
function privileged(identity){return identity?.system===true||identity?.elevated===true;}
function publisher(c,identity){if(!identity||identity.machine?.toLowerCase()!==c.machine.toLowerCase()||!c.publisherSids.includes(identity.sid)||!privileged(identity))fail('ADMIN_PUBLISHER_REJECTED');}
function issuer(c,identity){if(!identity||identity.machine?.toLowerCase()!==c.machine.toLowerCase()||!c.issuerSids.includes(identity.sid)||!privileged(identity))fail('ADMIN_ISSUER_REJECTED');}
export function authorize(c,g,r,identity,{now=Date.now()}={}){
 validateConfig(c);validateOperation(r);publisher(c,identity);
 if(c.profiles[r.profile]?.available===false)fail('ADMIN_PROFILE_UNAVAILABLE');
 if(r.operation.startsWith('github.')&&c.githubEnabled===false)fail('ADMIN_GITHUB_UNAVAILABLE');
 if(!g||g.schemaVersion!==2||!uuid.test(g.id||'')||g.id!==r.grantId||g.installationId!==c.installationId||g.machine!==c.machine||
 !Number.isSafeInteger(g.issuedAt)||g.issuedAt>now+30000||!Number.isSafeInteger(g.expiresAt)||g.expiresAt<=now||g.expiresAt-g.issuedAt>86400000||
 !Array.isArray(g.callerSids)||!g.callerSids.includes(identity.sid)||!Array.isArray(g.profiles)||!g.profiles.includes(r.profile)||
 !Array.isArray(g.capabilities)||!g.capabilities.includes(capability(r))||!c.issuerSids.includes(g.issuedBy))fail('ADMIN_GRANT_REJECTED');
 if(existsSync(inside(c.root,'revoked',g.id+'.json')))fail('ADMIN_GRANT_REVOKED');
 if(g.pathRoots!==undefined&&(r.operation.startsWith('file.')||r.operation.startsWith('acl.'))){
 if(!Array.isArray(g.pathRoots)||!g.pathRoots.some(root=>{const rel=relative(resolve(root),resolve(r.input.path));return rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}))fail('ADMIN_RESOURCE_REJECTED');
 noLinks(r.input.path);
 }
 if(r.operation.startsWith('acl.')&&r.operation!=='acl.inspect'&&r.profile==='user')fail('ADMIN_PROFILE_REJECTED');
 if(r.operation==='task.restart'&&r.input.processGuards?.length&&!g.capabilities.includes('process'))fail('ADMIN_GRANT_REJECTED');
 if(['process.run','script.run'].includes(r.operation)&&g.allowAnyCode!==true)fail('ADMIN_CODE_SCOPE_REJECTED');
 if(r.operation.startsWith('github.')&&r.profile!=='user'&&r.profile!=='user-admin')fail('ADMIN_PROFILE_REJECTED');
 return g;
}
export function createGrant(c,input,identity){
 validateConfig(c);issuer(c,identity);keys(input,['task','profiles','capabilities','callerSids','durationSeconds','allowAnyCode','pathRoots']);
 const allowed=['identity','process','script','file','github','service','registry','task','acl'];
 if(!text(input.task,1024)||!input.task.trim()||!Array.isArray(input.profiles)||!input.profiles.length||input.profiles.some(x=>!profiles.includes(x))||
 !Array.isArray(input.capabilities)||!input.capabilities.length||input.capabilities.some(x=>!allowed.includes(x))||!Array.isArray(input.callerSids)||!input.callerSids.length||
 input.callerSids.some(x=>!c.publisherSids.includes(x))||!Number.isSafeInteger(input.durationSeconds)||input.durationSeconds<60||input.durationSeconds>86400||
 (input.allowAnyCode!==undefined&&typeof input.allowAnyCode!=='boolean')||
 (input.pathRoots!==undefined&&(!Array.isArray(input.pathRoots)||!input.pathRoots.length||input.pathRoots.length>64||input.pathRoots.some(x=>!path(x)))))fail('ADMIN_GRANT_REJECTED');
 if(input.profiles.some(p=>c.profiles[p].available===false))fail('ADMIN_PROFILE_UNAVAILABLE');
 if(input.capabilities.includes('github')&&c.githubEnabled===false)fail('ADMIN_GITHUB_UNAVAILABLE');
 const now=Date.now(),g={schemaVersion:2,id:randomUUID(),installationId:c.installationId,machine:c.machine,...input,issuedAt:now,expiresAt:now+input.durationSeconds*1000,issuedBy:identity.sid};
 writeFileSync(inside(c.root,'grants',g.id+'.json'),JSON.stringify(g)+'\n',{flag:'wx'});return g;
}
export function revokeGrant(c,id,identity){validateConfig(c);issuer(c,identity);if(!uuid.test(id||''))fail('ADMIN_GRANT_REJECTED');atomic(inside(c.root,'revoked',id+'.json'),{revokedAt:new Date().toISOString(),issuer:identity.sid});return {id,revoked:true};}
export function nativeCodec(c){
 const call=(mode,input)=>{const p=spawnSync(c.helperPath,[mode],{input,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8*1024*1024});if(p.status!==0)fail('ADMIN_CRYPTO_UNAVAILABLE');return p.stdout.trim();};
 return {protect:s=>call('protect',s),unprotect:s=>Buffer.from(call('unprotect',s),'base64').toString('utf8')};
}
function inputDigest(r){return sha(JSON.stringify({grantId:r.grantId,profile:r.profile,operation:r.operation,input:r.input}));}
export function enqueue(c,r,{identity,codec=nativeCodec(c),now=Date.now()}={}){
 validateConfig(c);publisher(c,identity);keys(r,['id','grantId','profile','operation','input']);
 if(!uuid.test(r.id||'')||!uuid.test(r.grantId||''))fail('ADMIN_REQUEST_REJECTED');validateOperation(r);
 const g=readJSON(inside(c.root,'grants',r.grantId+'.json'),65536);authorize(c,g,r,identity,{now});
 const p=inside(c.root,'requests',r.id+'.json'),fingerprint=inputDigest(r);
 if(existsSync(p)){const old=readJSON(p);if(old.digest!==fingerprint||old.publisherSid!==identity.sid)fail('ADMIN_REQUEST_ID_REUSED');return old;}
 const env={schemaVersion:2,id:r.id,installationId:c.installationId,grantId:r.grantId,profile:r.profile,publisherSid:identity.sid,
 digest:fingerprint,issuedAt:now,dispatchExpiresAt:g.expiresAt,payload:codec.protect(JSON.stringify(r))};
 writeFileSync(p,JSON.stringify(env)+'\n',{flag:'wx'});atomic(inside(c.root,'lanes',r.profile,'queue',r.id+'.json'),{id:r.id});return env;
}
export function redact(value){
 if(typeof value==='string')return value.replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/g,'[REDACTED]')
 .replace(/((?:proxy-)?authorization\s*[:=]\s*(?:bearer|basic)\s+)\S+/gi,'$1[REDACTED]')
 .replace(/((?:password|secret|token)\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]');
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(?:(?:.*_)?(?:password|passwd|secret|token|private_key|client_secret)(?:_hash|_value)?|authorization|cookie|set-cookie)$/i.test(k)?'[REDACTED]':redact(v)]));
 return value;
}
export function publicError(e){return {code:/^ADMIN_[A-Z_]+$/.test(e?.code||'')?e.code:'ADMIN_OPERATION_FAILED',
 ...(Number.isInteger(e?.httpStatus)&&e.httpStatus>=400&&e.httpStatus<600?{httpStatus:e.httpStatus}:{}),
 ...(['PERMISSION_DENIED','NOT_FOUND','VALIDATION_REJECTED','RATE_LIMITED','AUTHENTICATION_REQUIRED'].includes(e?.reason)?{reason:e.reason}:{}),
 ...(Number.isInteger(e?.exitCode)?{exitCode:e.exitCode}:{}),
 ...(Number.isInteger(e?.nativeCode)?{nativeCode:e.nativeCode}:{}),
 ...(e?.diagnostics?{diagnostics:redact(e.diagnostics)}:{})};}
export function resultFor(c,id){
 validateConfig(c);if(!uuid.test(id||''))fail('ADMIN_REQUEST_REJECTED');const env=readJSON(inside(c.root,'requests',id+'.json'));
 const p=inside(c.root,'lanes',env.profile,'responses',id+'.json');
 if(!existsSync(p))return {id,ok:false,error:{code:existsSync(inside(c.root,'lanes',env.profile,'claims',id+'.json'))?'ADMIN_OUTCOME_UNCERTAIN':'ADMIN_PENDING'}};
 const reply=readJSON(p);if(reply.id!==id||reply.digest!==env.digest||reply.installationId!==c.installationId||reply.identity?.sid!==c.profiles[env.profile].sid)fail('ADMIN_RESULT_REJECTED');return reply;
}
export async function processQueue(c,profile,{identity,codec=nativeCodec(c),execute,now=()=>Date.now()}={}){
 if(c.profiles?.[profile]?.available===false)fail('ADMIN_PROFILE_UNAVAILABLE');
 validateConfig(c);if(!profiles.includes(profile)||identity?.machine?.toLowerCase()!==c.machine.toLowerCase()||
 identity.sid!==c.profiles[profile].sid||(c.profiles[profile].elevated?(!identity.elevated&&!identity.system):(identity.elevated||identity.system)))fail('ADMIN_EXECUTION_IDENTITY_REJECTED');
 const queue=inside(c.root,'lanes',profile,'queue');let count=0;
 for(const name of readdirSync(queue).filter(x=>uuid.test(x.slice(0,-5))&&x.endsWith('.json')).sort().slice(0,32)){
 const id=name.slice(0,-5),pending=inside(queue,name),running=inside(queue,id+'.running');
 if(existsSync(running)){unlinkSync(pending);continue;}
 try{renameSync(pending,running);}catch(e){if(e.code==='ENOENT')continue;throw e;}
 let env,reply;const startedAt=new Date().toISOString(),response=inside(c.root,'lanes',profile,'responses',name);
 try{
 env=readJSON(inside(c.root,'requests',name));if(env.id!==id||env.profile!==profile||env.installationId!==c.installationId)fail('ADMIN_REQUEST_REJECTED');
 if(existsSync(response)){resultFor(c,id);unlinkSync(running);continue;}
 if(env.dispatchExpiresAt<now())fail('ADMIN_REQUEST_EXPIRED');
 const r=JSON.parse(codec.unprotect(env.payload));if(r.id!==id||r.profile!==profile||r.grantId!==env.grantId||inputDigest(r)!==env.digest)fail('ADMIN_REQUEST_REJECTED');
 const g=readJSON(inside(c.root,'grants',env.grantId+'.json'),65536);
 authorize(c,g,r,{sid:env.publisherSid,machine:c.machine,elevated:true},{now:now()});
 const claim=inside(c.root,'lanes',profile,'claims',name);
 if(existsSync(claim))fail('ADMIN_OUTCOME_UNCERTAIN');
 writeFileSync(claim,JSON.stringify({digest:env.digest,startedAt})+'\n',{flag:'wx'});
 const cancel=inside(c.root,'lanes',profile,'cancel',name);
 if(existsSync(cancel))fail('ADMIN_CANCELLED');
 const data=await execute(r,{grant:g,cancelFile:cancel,revokedFile:inside(c.root,'revoked',g.id+'.json')});
 reply={ok:true,data:redact(data)};
 }catch(e){reply={ok:false,error:publicError(e)};}
 atomic(response,{schemaVersion:2,installationId:c.installationId,id,digest:env?.digest||'',profile,identity,startedAt,finishedAt:new Date().toISOString(),...reply});
 unlinkSync(running);count++;
 }return count;
}
