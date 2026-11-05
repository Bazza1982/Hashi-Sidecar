import test from 'node:test';
import assert from 'node:assert/strict';
import {settledReply,waitForReply} from '../scripts/admin-sidecar/cli.mjs';
const uncertain={id:'fixture',ok:false,error:{code:'ADMIN_OUTCOME_UNCERTAIN'}};
const pending={id:'fixture',ok:false,error:{code:'ADMIN_PENDING'}};
const success={id:'fixture',ok:true,data:{sid:'observed'}};
test('a response persisted between reads replaces the stale uncertain observation',()=>{
 let reads=0;const reply=settledReply(()=>++reads===1?uncertain:success,()=>true);
 assert.equal(reply.ok,true);assert.equal(reads,2);
});
test('a persisted uncertain receipt remains terminal without dispatching its effect',async()=>{
 let dispatches=0;
 const r=await waitForReply({read:()=>uncertain,persisted:()=>true,state:()=>{throw Error('should not query');},dispatch:()=>dispatches++,deadline:Date.now()+1000});
 assert.equal(r.error.code,'ADMIN_OUTCOME_UNCERTAIN');assert.equal(dispatches,0);
});
test('a transient idle scheduler observation does not abandon an active claim or replay it',async()=>{
 let clock=0,dispatches=0;
 const r=await waitForReply({read:()=>clock<400?uncertain:success,persisted:()=>clock>=400,state:()=>clock<200?'Ready':'Running',
 dispatch:()=>dispatches++,wait:async ms=>{clock+=ms},now:()=>clock,deadline:1000});
 assert.equal(r.ok,true);assert.equal(dispatches,0);
});
test('an interrupted idle claim settles as uncertain and is never redispatched',async()=>{
 let clock=0,dispatches=0;
 const r=await waitForReply({read:()=>uncertain,persisted:()=>false,state:()=>'Ready',dispatch:()=>dispatches++,
 wait:async ms=>{clock+=ms},now:()=>clock,deadline:5000,orphanGraceMs:600});
 assert.equal(r.error.code,'ADMIN_OUTCOME_UNCERTAIN');assert.equal(dispatches,0);assert.ok(clock>=600);
});
test('pending work dispatches once and returns the durable reply',async()=>{
 let clock=0,dispatches=0;
 const r=await waitForReply({read:()=>clock<400?pending:success,persisted:()=>clock>=400,state:()=>'Ready',
 dispatch:()=>dispatches++,wait:async ms=>{clock+=ms},now:()=>clock,deadline:1000});
 assert.equal(r.ok,true);assert.equal(dispatches,1);
});
