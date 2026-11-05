import test from 'node:test';
import assert from 'node:assert/strict';
import {claimState,parseArgs} from '../scripts/admin-sidecar/cli.mjs';
import {redact} from '../scripts/admin-sidecar/core.mjs';
test('an actively running claim is awaited rather than prematurely returned as uncertain',()=>{
 const r={ok:false,error:{code:'ADMIN_OUTCOME_UNCERTAIN'}};
 assert.equal(claimState(r,{running:true,persisted:false}),'wait');
 assert.equal(claimState(r,{running:false,persisted:false}),'uncertain');
 assert.equal(claimState(r,{running:true,persisted:true}),'finished');
});
test('known completed success and rejection results remain terminal',()=>{
 assert.equal(claimState({ok:true,data:{}},{running:true}),'finished');
 assert.equal(claimState({ok:false,error:{code:'ADMIN_STALE_STATE'}},{running:true}),'finished');
});
test('administration CLI accepts structured calls and rejects worker/configuration overrides',()=>{
 assert.equal(parseArgs(['call','--grant','id','--profile','system','--operation','identity']).command,'call');
 for(const argv of [['call','--config','elsewhere'],['call','--grant','id','--profile','system','--operation','identity','--command','text'],['--worker']])
 assert.throws(()=>parseArgs(argv));
});
test('secret value masking preserves secret-list metadata and token counts',()=>{
 const r=redact({secrets:[{name:'DEPLOY_KEY',updated_at:'today'}],token_count:12,client_secret:'private'});
 assert.deepEqual(r.secrets,[{name:'DEPLOY_KEY',updated_at:'today'}]);assert.equal(r.token_count,12);assert.equal(r.client_secret,'[REDACTED]');
});
