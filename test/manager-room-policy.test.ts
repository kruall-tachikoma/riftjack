import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomPolicies } from '../src/room-policies.js';
import { ManagerHistory } from '../src/manager-history.js';

test('room grants remain scoped and require current private room membership', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'policy-'));
 try {
 const p = new RoomPolicies(join(dir, 'policies.json'), '@owner:example.org');
 const policy = {bot:'@bot:example.org',room:'!room:example.org',audience:'members',users:[],mode:'mentions'};
 assert.throws(() => p.set('@guest:example.org', policy));
 p.set('@owner:example.org', policy);
 assert.equal(p.has(policy.bot, '!other:example.org', '@guest:example.org'), false);
 const state = [
 {type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2'}},
 {type:'m.room.join_rules',state_key:'',content:{join_rule:'invite'}},
 {type:'m.room.history_visibility',state_key:'',content:{history_visibility:'joined'}},
 ...[policy.bot,'@guest:example.org'].map(id=>({type:'m.room.member',state_key:id,content:{membership:'join'}}))];
 assert.equal(await p.allowed(policy.bot,policy.room,'@guest:example.org',async()=>state),true);
 assert.equal(await p.allowed(policy.bot,policy.room,'@guest:example.org',async()=>state.slice(0,-1)),false);
 assert.equal(await p.triggers(policy.bot,policy.room,{content:{body:'ordinary text'}},async()=>undefined),false);
 assert.equal(await p.triggers(policy.bot,policy.room,{content:{'m.mentions':{user_ids:[policy.bot]}}},async()=>undefined),true);
 p.set('@owner:example.org',{...policy,mode:'off'});
 assert.equal(new RoomPolicies(join(dir,'policies.json'),'@owner:example.org').has(policy.bot,policy.room,'@guest:example.org'),false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('uncertain manager operations survive reload and recent history truncation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'manager-history-'));
 try {
 const file=join(dir,'history.json'), h=new ManagerHistory(file);
 const run=h.begin('a','request',['invite bot @bot:example.org to !room:example.org']);
 h.update(run,{state:'running'});
 for(let i=0;i<12;i++){const next=h.begin('a','read',[]);h.update(next,{state:'complete'});}
 const reloaded=new ManagerHistory(file);
 assert.equal(reloaded.recent('a').length,8);
 assert.equal(reloaded.unresolved(run.commands[0]),true);
 assert.equal(reloaded.unresolved('another command'),false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
