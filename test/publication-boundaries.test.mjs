import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectPublicationFile,auditPublication} from '../scripts/check-publication.mjs';
test('publication rejects host/profile/network/account details without echoing their values',()=>{
 const address=[192,168,7,91].join('.'),sid=['S','1','5','21',123456789,987654321,456789012,1001].join('-');
 const path=['C:','Users','private-person','settings.json'].join('\\');
 const report=inspectPublicationFile('docs/example.md',[address,sid,path,'DESKTOP'+'-LOCAL123'].join('\n'));
 assert.deepEqual(new Set(report.map(r=>r.code)),new Set(['private-network-address','account-specific-sid','machine-specific-path','machine-hostname']));
 assert.ok(!JSON.stringify(report).includes(address));assert.ok(!JSON.stringify(report).includes(sid));
});
test('public examples and narrowly synthetic test SIDs remain usable',()=>{
 assert.equal(inspectPublicationFile('test/example.test.mjs','S-1-5-21-1-2-3-1001').length,0);
 assert.equal(inspectPublicationFile('docs/example.md','S-1-5-21-1-2-3-1001')[0].code,'account-specific-sid');
 assert.equal(inspectPublicationFile('README.md','<TargetSid> <AbsoluteInstallRoot> 127.0.0.1').length,0);
});
test('publication excludes credential/generated paths while permitting example configuration',()=>{
 for(const path of ['config/local.json','state/requests/job.json','.env','.git-credentials','source.bundle','worker.exe','control.sqlite']){
  assert.ok(inspectPublicationFile(path,'fixture').length,path);
 }
 assert.equal(inspectPublicationFile('examples/accounts.example.json','{}').length,0);
});
test('all-ref history inspection detects private data removed from the current checkout',()=>{
 const root=mkdtempSync(join(tmpdir(),'publication-history-'));
 const git=args=>{const p=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stderr);};
 git(['init','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['config','core.hooksPath',join(root,'no-hooks')]);
 writeFileSync(join(root,'note.txt'),[10,20,30,40].join('.'));git(['add','.']);git(['commit','-m','fixture']);
 unlinkSync(join(root,'note.txt'));writeFileSync(join(root,'README.md'),'Public source');git(['add','--all']);git(['commit','-m','remove private fixture']);
 assert.equal(auditPublication(root).ok,true);
 const history=auditPublication(root,{history:true});assert.equal(history.ok,false);assert.equal(history.commits,2);
 assert.ok(history.findings.some(r=>r.code==='private-network-address'&&r.object));
});
