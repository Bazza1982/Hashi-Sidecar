import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

export function inspectPublicationFile(path,content){
 const file=path.replaceAll('\\','/'),issues=[];
 const add=(code,line=0)=>issues.push({file,code,line});
 if(/(?:^|\/)(?:state|config|node_modules|coverage|dist|\.git)(?:\/|$)/i.test(file)&&!file.endsWith('.example.json'))add('private-or-generated-path');
 if(/(?:^|\/)(?:\.env(?:\..*)?|\.git-credentials|\.gitconfig|id_rsa|id_ed25519)$/i.test(file)&&!file.endsWith('.example'))add('credential-file');
 if(/\.(?:sqlite\d*|db|log|bundle|pfx|p12|pem|key|exe|dll|zip|tgz)$/i.test(file))add('private-or-generated-file');
 if(content.includes('\0')){add('binary-content');return issues;}
 const lines=content.split(/\r?\n/);
 for(let index=0;index<lines.length;index++){
  const text=lines[index],line=index+1;
  if(/\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/.test(text))add('private-network-address',line);
  if(/\b(?:DESKTOP|LAPTOP|WIN)-[A-Z0-9]{4,}\b/i.test(text))add('machine-hostname',line);
  if(/[a-z]:[\\/]+(?:Users|Projects|ProgramData)[\\/]+(?![<%])/i.test(text)||/\/home\/(?![<%])[a-z0-9_.-]+\//i.test(text))add('machine-specific-path',line);
  for(const match of text.matchAll(/S-1-5-21-\d+-\d+-\d+-\d+/g)){
   const synthetic=file.startsWith('test/')&&/^S-1-5-21-(?:1-2-3|11-22-33|111-222-333)-\d+$/.test(match[0]);
   if(!synthetic)add('account-specific-sid',line);
  }
 }
 return issues;
}
function git(root,args,input){
 const p=spawnSync('git',['-C',root,...args],{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
 if(p.status!==0)throw new Error('Publication audit could not read Git data.');
 return p.stdout;
}
function sourceFiles(root){
 const ignored=new Set(['.git']);
 const walk=folder=>readdirSync(folder,{withFileTypes:true}).flatMap(e=>ignored.has(e.name)?[]:
 e.isDirectory()?walk(join(folder,e.name)):[relative(root,join(folder,e.name)).replaceAll('\\','/')]);
 return walk(root);
}
export function auditPublication(root,{history=false}={}){
 root=resolve(root);const hasGit=existsSync(join(root,'.git'));
 if(history&&!hasGit)throw new Error('History audit requires a Git checkout.');
 const files=hasGit?[...new Set([...git(root,['ls-files','-z']).split('\0'),...git(root,['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))]:sourceFiles(root);
 const findings=[];
 for(const path of files){
  const full=join(root,path);
  if(!existsSync(full)){findings.push({file:path,code:'missing-tracked-file',line:0});continue;}
  if(lstatSync(full).isSymbolicLink()){findings.push({file:path,code:'source-link',line:0});continue;}
  findings.push(...inspectPublicationFile(path,readFileSync(full,'utf8')));
 }
 let commits=0,blobs=0;
 if(history){
  commits=git(root,['rev-list','--all']).trim().split('\n').filter(Boolean).length;
  const objects=git(root,['rev-list','--objects','--all']).split('\n').filter(Boolean).map(row=>{const at=row.indexOf(' ');return {id:at<0?row:row.slice(0,at),path:at<0?'':row.slice(at+1)};});
  const types=git(root,['cat-file','--batch-check=%(objectname) %(objecttype)'],objects.map(o=>o.id).join('\n')+'\n').trim().split('\n');
  for(let index=0;index<objects.length;index++){
   if(!types[index]?.endsWith(' blob'))continue;
   const object=objects[index];blobs++;
   findings.push(...inspectPublicationFile(object.path,git(root,['cat-file','blob',object.id])).map(issue=>({...issue,object:object.id})));
  }
 }
 return {ok:findings.length===0,files:files.length,commits,blobs,findings};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),report=auditPublication(root,{history:process.argv.includes('--history')});
  console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
 }catch{console.error('Publication audit failed; source or Git history could not be inspected.');process.exitCode=2;}
}
