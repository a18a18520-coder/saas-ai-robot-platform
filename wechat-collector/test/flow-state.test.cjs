'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {collectionReadiness:readiness}=require('../desktop/renderer/flow-state.js');
const group={id:'one',name:'合成甲群',sourceId:'window:1',regions:{entry:{}}};
const base={info:{ready:true,platform:'darwin',screenPermission:'granted'},connected:true,sourceId:'window:1',group,selected:[group],scroll:'none',controlReady:false,interval:'10',count:'0',history:'10',rotationHistory:'10',captureConsent:true,scrollConsent:true,monitorConsent:true};
test('screenshot-only ready without control permission; scroll never is',()=>{
  assert.equal(readiness(base).ready,true);
  for(const scroll of ['up','down'])assert.equal(readiness({...base,scroll}).target,'permission-panel');
  assert.equal(readiness({...base,rotate:true}).target,'permission-panel');
});
test('connection and explicit selection are required, not inferred from saved groups',()=>{
  assert.equal(readiness({...base,connected:false}).target,'quick-connect');
  assert.equal(readiness({...base,group:null}).target,'current-panel');
  assert.equal(readiness({...base,sourceId:'another'}).target,'current-panel');
  assert.equal(readiness({...base,rotate:true,selected:[]}).target,'specified-panel');
});
test('storage, recording and busy states block readiness',()=>{
  for(const state of [{info:null},{info:{ready:false}},{info:{...base.info,screenPermission:'denied'}},{active:true},{busy:true},{guided:true}])assert.equal(readiness({...base,...state}).ready,false);
});
test('rotation requires an entry for every selected target',()=>{
  assert.equal(readiness({...base,rotate:true,controlReady:true,selected:[group,{...group,name:'未绑定入口',regions:{}}]}).target,'specified-panel');
});
test('invalid numeric fields show the exact field, including blanks and decimals',()=>{
  for(const value of ['',-1,1.2,3601])assert.equal(readiness({...base,interval:value}).target,'interval');
  for(const value of ['',-1,51,1.2])assert.equal(readiness({...base,count:value}).target,'count');
  for(const value of ['',0,31,1.2])assert.equal(readiness({...base,scroll:'up',controlReady:true,history:value}).target,'current-history');
  assert.equal(readiness({...base,rotate:true,controlReady:true,interval:2}).target,'interval');
  assert.equal(readiness({...base,rotate:true,controlReady:true,rotationHistory:31}).target,'rotation-history');
});
test('each action retains separate consent and readiness never auto-confirms',()=>{
  assert.equal(readiness({...base,captureConsent:false}).target,'capture-consent');
  assert.equal(readiness({...base,scroll:'down',controlReady:true,scrollConsent:false}).target,'scroll-consent');
  assert.equal(readiness({...base,rotate:true,controlReady:true,monitorConsent:false}).target,'monitor-consent');
  assert.equal(readiness({...base,rotate:true,controlReady:true}).ready,true);
});
test('refresh never automatically selects the only saved conversation',async()=>{
  const fs=require('node:fs/promises'),vm=require('node:vm');const elements={};
  const el=id=>elements[id]??={value:'',replaceChildren(option){this.value=option.value;},add(){}};
  const ctx={window:{},$:el,latestEpoch:0,latestId:null,Option:function(text,value){this.value=value;},controls(){},api(){throw Error('must not load old contents');}};
  const source=await fs.readFile(require('node:path').join(__dirname,'../desktop/renderer/sidecar.js'),'utf8');
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('window.refreshSidecar ='),source.indexOf('window.focusCapturedGroup =')),ctx);
  await ctx.window.refreshSidecar({groups:[group],captures:[{id:'old',group:{id:group.id}}]});assert.equal(el('current-group').value,'');assert.equal(ctx.latestId,null);
  el('current-group').value=group.id;await ctx.window.refreshSidecar({groups:[group],captures:[]});assert.equal(el('current-group').value,group.id);
});
