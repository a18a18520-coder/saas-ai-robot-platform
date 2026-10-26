'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { groupConfig } = require('../src/core/groups.cjs');
const { rebindGroup, rawExport } = require('../src/core/onboarding.cjs');
const { Store } = require('../src/core/store.cjs');
function group() { return groupConfig({ id:'group-A', name:'合成测试甲群', sourceName:'微信', sourceId:'window:1:0', titleImageHash:'a'.repeat(64), nativeSize:{width:900,height:600}, geometry:{width:900,height:600}, regions:{title:{x:300,y:15,width:570,height:60},messages:{x:300,y:100,width:580,height:380}}, historyScreens:0,intervalSeconds:30 }); }
function fixture() {
  const original=group(), log=[];
  const driver={ group:id=>id===original.id?original:null, source:()=>({id:'window:2:0',name:'微信'}), epoch:()=>1,
    inspect:async next=>{assert.deepEqual(next.nativeSize,original.nativeSize);log.push('inspect');},
    verify:async next=>{assert.equal(next.titleImageHash,original.titleImageHash);log.push('verify');},
    save:async(next,valid)=>{assert.ok(valid());log.push('save');return next;} };
  return {original,driver,log};
}
test('restore requires explicit user confirmation and an existing calibrated group',async()=>{
  const {driver}=fixture();await assert.rejects(rebindGroup({id:'group-A',confirmed:false},driver),/确认/);
  await assert.rejects(rebindGroup({id:'unknown',confirmed:true},driver),/请选择/);
  driver.source=()=>null;await assert.rejects(rebindGroup({id:'group-A',confirmed:true},driver),/请选择/);
});
test('restore changes only source binding after native and title verification',async()=>{
  const {driver,original,log}=fixture();const result=await rebindGroup({id:original.id,confirmed:true,frame:{}},driver);
  assert.deepEqual(log,['inspect','verify','save']);assert.equal(result.sourceId,'window:2:0');
  assert.deepEqual({...result,sourceId:original.sourceId},original);
});
for(const stage of ['inspect','verify'])test(`restore ${stage} failure never saves or relaxes identity`,async()=>{
  const {driver,log}=fixture();driver[stage]=async()=>{throw Error('不匹配');};
  await assert.rejects(rebindGroup({id:'group-A',confirmed:true},driver),/不匹配/);assert.ok(!log.includes('save'));
});
test('restore cancelled during verification cannot update source',async()=>{
  const {driver,log}=fixture();driver.verify=async()=>{driver.epoch=()=>2;};
  await assert.rejects(rebindGroup({id:'group-A',confirmed:true},driver),/取消/);assert.ok(!log.includes('save'));
});
test('restore cancelled during encryption preserves prior configuration on disk',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'collector-rebind-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'data'),{encode:s=>Buffer.from(s),decode:b=>b.toString()});
  await store.saveGroup(group());const before=await fs.readFile(store.file);let valid=true,release;
  store.codec.encode=s=>new Promise(resolve=>{release=()=>resolve(Buffer.from(s));});
  const pending=store.saveGroup({...group(),sourceId:'window:2:0'},()=>valid);
  await new Promise(resolve=>setImmediate(resolve));valid=false;release();await assert.rejects(pending,/未保存/);
  assert.deepEqual(await fs.readFile(store.file),before);assert.equal(store.snapshot().groups[0].sourceId,'window:1:0');
});
test('raw export is explicitly unreviewed, scoped to one group and excludes images/secrets',()=>{
  const row={id:'capture-A',group:{id:'group-A',name:'合成测试甲群'},capturedAt:'2026-10-24T00:00:00Z',ocrText:'金额 1.2 万元；否',confidence:82,sourceName:'微信',image:'private-image',token:'private-token'};
  const result=rawExport({groups:[group()],captures:[row,{...row,id:'capture-B',group:{id:'group-B'}}]},'group-A');
  assert.equal(result.kind,'unreviewed-ocr');assert.equal(result.captures.length,1);assert.equal(result.captures[0].ocrText,row.ocrText);
  assert.ok(!JSON.stringify(result).includes('private-'));assert.ok(!('sentAt' in result.captures[0]));
});
test('raw export rejects implicit all-groups and empty selection',()=>{
  const data={groups:[group()],captures:[]};for(const id of ['',undefined,'unknown','group-A'])assert.throws(()=>rawExport(data,id));
});
test('raw-export IPC writes only selected originals after save dialog confirmation',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'collector-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'originals.json'), source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');let handler;
  const captures=[{id:'one',group:{id:'group-A'},ocrText:'合成原文',image:'excluded',capturedAt:'2026-10-24T00:00:00Z'}];
  const ctx={handle:(_name,fn)=>{handler=fn;},rawExport,snapshot:()=>({groups:[group()],captures}),dialog:{showSaveDialog:async()=>({canceled:false,filePath:file})},win:{},fs};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf("  handle('export-raw'"),source.indexOf("  handle('clear'")),ctx);
  const result=await handler('group-A');assert.equal(result.count,1);
  const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.kind,'unreviewed-ocr');assert.equal(saved.captures[0].ocrText,'合成原文');assert.ok(!saved.captures[0].image);
  await assert.rejects(handler('other'),/选择/);
});
test('raw-export cancellation performs no file write',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');let handler,writes=0;
  const ctx={handle:(_name,fn)=>{handler=fn;},rawExport,snapshot:()=>({groups:[group()],captures:[{group:{id:'group-A'}}]}),dialog:{showSaveDialog:async()=>({canceled:true})},win:{},fs:{writeFile:async()=>{writes++;}}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf("  handle('export-raw'"),source.indexOf("  handle('clear'")),ctx);
  assert.equal((await handler('group-A')).canceled,true);assert.equal(writes,0);
});

async function renderer() {
  const actions={},elements={},calls=[];
  const el=id=>elements[id]??={value:'',hidden:false,disabled:false,checked:false,classList:{toggle(){}},setAttribute(){},replaceChildren(...options){this.options=options;this.value=options[0]?.value;},add(option){this.options.push(option);},scrollIntoView(){},focus(){}};
  const ctx={window:{collectorMonitorActive:()=>false},$:el,groups:[],running:false,working:false,controlReady:false,checkingControl:false,stream:null,source:null,calibration:{},editingGroup:null,
    collectionReadiness:require('../desktop/renderer/flow-state.js').collectionReadiness,
    controls(){ctx.window.onboardingControls?.();},status:message=>calls.push(['status',message]),action:(id,fn)=>actions[id]=fn,Option:function(text,value){this.text=text;this.value=value;},
    api:async(method,...args)=>{calls.push([method,...args]);if(method==='info')return {ready:true,platform:'preview'};if(method==='wechatSources')return [{id:'window:1:0',name:'微信'}];return true;},
    connectSource:async id=>{calls.push(['connect',id]);ctx.stream={};ctx.source={id};},freeze(){},groupFrame:async()=>({}),refreshState:async()=>{},begin:async count=>calls.push(['begin',count])};
  vm.createContext(ctx);vm.runInContext(await fs.readFile(path.join(__dirname,'../desktop/renderer/onboarding.js'),'utf8'),ctx);
  await new Promise(resolve=>setImmediate(resolve));return {ctx,actions,elements,calls,el};
}
test('permission step folds for screenshot mode and opens when scrolling needs control',async()=>{
  const {ctx,el,actions}=await renderer();el('scroll-mode').value='none';await actions['check-environment']();
  assert.equal(el('permission-panel').open,false);assert.equal(el('permission-state').textContent,'可截图');
  el('scroll-mode').value='up';ctx.stream={};ctx.window.onboardingControls();
  assert.equal(el('permission-panel').open,true);assert.equal(el('permission-state').textContent,'待控制授权');
});
test('disconnect releases binding UI without deleting saved identities',async()=>{
  const {ctx,actions,el}=await renderer();ctx.stream={};ctx.groups=[group()];
  await actions['bind-current']();assert.equal(ctx.window.isBindingConversation(),true);
  ctx.window.onPreviewDisconnected();assert.equal(ctx.window.isBindingConversation(),false);assert.equal(el('guided-region').hidden,true);assert.equal(ctx.groups.length,1);
});
test('rotation row edit uses fresh guided calibration and preserves identity',async()=>{
  const {ctx,el}=await renderer();ctx.stream={};ctx.groups=[group()];ctx.window.isRotationEnabled=()=>true;let freezes=0;ctx.freeze=()=>{freezes++;ctx.calibration={};};
  await ctx.window.editBoundConversation('group-A');assert.equal(freezes,1);assert.equal(ctx.editingGroup.id,'group-A');assert.equal(el('pick-entry').hidden,false);assert.equal(el('roi-purpose').value,'title');
});
test('quick connection connects exactly one verified WeChat candidate, never auto-starts',async()=>{
  const {ctx,actions,calls}=await renderer();await actions['quick-connect']();assert.ok(ctx.stream);
  assert.equal(calls.filter(([method])=>method==='connect').length,1);assert.ok(!calls.some(([method])=>method==='currentStart'||method==='begin'));
});
test('zero or multiple WeChat candidates require user selection, never guess',async()=>{
  for(const list of [[],[{id:'window:1:0',name:'微信'},{id:'window:2:0',name:'微信'}]]){
    const {ctx,actions,calls,el}=await renderer();ctx.api=async()=>list;
    await assert.rejects(actions['quick-connect'](),/微信窗口/);assert.ok(!calls.some(([method])=>method==='connect'));assert.equal(el('setup-panel').open,true);assert.equal(ctx.working,false);
  }
});
test('first capture forwards a bounded single run and keeps existing consent guard',async()=>{
  const {actions,calls,el,ctx}=await renderer();el('capture-one').disabled=true;ctx.window.onboardingControls();assert.equal(el('first-capture').disabled,true);
  await actions['first-capture']();assert.deepEqual(calls.at(-1),['begin',1]);
});
test('guided calibration is two visual regions, manual name confirmation, no automatic save',async()=>{
  const {ctx,actions,el,calls}=await renderer();ctx.stream={};await actions['quick-calibrate']();assert.equal(el('roi-purpose').value,'title');
  ctx.calibration.title={};ctx.window.onRegionSelected('title');assert.equal(el('roi-purpose').value,'messages');
  ctx.calibration.messages={};ctx.window.onRegionSelected('messages');assert.match(el('guided-instruction').textContent,/完整会话名/);
  assert.ok(!calls.some(([method])=>method==='saveGroup'||method==='currentStart'));
});
test('bind current starts a new identity even when an old conversation is selected',async()=>{
  const {ctx,actions,el,calls}=await renderer();ctx.stream={};ctx.groups=[group()];el('current-group').value='group-A';
  await actions['bind-current']();assert.equal(ctx.editingGroup,null);assert.equal(el('group-name').value,'');assert.equal(el('group-name').readOnly,false);
  assert.ok(!calls.some(([method])=>method==='saveGroup'));assert.equal(ctx.groups[0].name,'合成测试甲群');
});
test('adjust range preserves the selected identity instead of replacing it',async()=>{
  const {ctx,actions,el}=await renderer();ctx.stream={};ctx.groups=[group()];el('current-group').value='group-A';
  await actions['quick-calibrate']();assert.equal(ctx.editingGroup.id,'group-A');assert.equal(el('group-name').readOnly,true);
});
test('rotation binding guides title, message area and left entry in order',async()=>{
  const {ctx,actions,el,calls}=await renderer();ctx.stream={};ctx.window.isRotationEnabled=()=>true;
  await actions['bind-current']();assert.equal(el('pick-entry').hidden,false);
  ctx.calibration.title={};ctx.window.onRegionSelected('title');assert.equal(el('roi-purpose').value,'messages');
  ctx.calibration.messages={};ctx.window.onRegionSelected('messages');assert.equal(el('roi-purpose').value,'entry');
  ctx.calibration.entry={};ctx.window.onRegionSelected('entry');assert.match(el('guided-instruction').textContent,/确认并绑定/);
  assert.ok(!calls.some(([method])=>method==='currentStart'||method==='monitorStart'));
});
