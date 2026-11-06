import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const path of ['src','member-web','node_modules','package-lock.json']){
 if(existsSync(join(root,path)))throw new Error('Sidecar source slice contains an unrelated dependency/application path: '+path);
}
function files(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(folder,e.name)):[join(folder,e.name)]);}
const source=[...files(join(root,'scripts')),...files(join(root,'test'))],docs=[join(root,'README.md'),join(root,'AGENTS.md'),...files(join(root,'docs')),...source.filter(p=>p.endsWith('.md'))];
function run(exe,args){const p=spawnSync(exe,args,{cwd:root,encoding:'utf8'});if(p.status!==0)throw new Error((p.stdout||'')+(p.stderr||'')+(p.error?.message||''));}
for(const path of source.filter(p=>p.endsWith('.mjs')))run(process.execPath,['--check',path]);
for(const path of [join(root,'package.json'),...source.filter(p=>p.endsWith('.json'))])JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
for(const path of docs){
 for(const link of readFileSync(path,'utf8').matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)){
  const value=link[1];if(value.startsWith('#')||/^[a-z][a-z\d+.-]*:/i.test(value))continue;
  const target=resolve(dirname(path),decodeURIComponent(value.split('#')[0]));
  if(!existsSync(target))throw new Error('Missing documentation target in '+path+': '+value);
 }
}
const ps=source.filter(p=>p.endsWith('.ps1'));
if(process.platform==='win32'){
 const list=ps.map(p=>"'"+p.replaceAll("'","''")+"'").join(',');
 const command="$ErrorActionPreference='Stop';foreach($v2File in @("+list+")){$v2Tokens=$null;$v2Errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($v2File,[ref]$v2Tokens,[ref]$v2Errors);if($v2Errors.Count){$v2Errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}}";
 run(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',command]);
 console.log('PowerShell parsers passed for '+ps.length+' Sidecar/helper scripts.');
}else console.log('PowerShell parser/native execution checks require Windows; portable checks run here.');
console.log('Standalone Sidecar syntax, JSON, documentation and source-boundary checks passed.');
