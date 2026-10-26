'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CurrentSession } = require('../src/core/current-session.cjs');
const { CurrentMonitor } = require('../desktop/renderer/current-monitor.js');
const { groupConfig } = require('../src/core/groups.cjs');
const { Store } = require('../src/core/store.cjs');
const { dockBounds } = require('../src/core/docking.cjs');
const config = () => groupConfig({name:'合成测试甲群',sourceId:'window:1:0',sourceName:'微信',geometry:{width:1000,height:800},regions:{title:{x:300,y:20,width:400,height:50},messages:{x:300,y:100,width:650,height:500}},historyScreens:0,intervalSeconds:30,nativeSize:{width:1000,height:800},titleImageHash:'a'.repeat(64)});
function setup() {
  const group = config(), calls = [];
  const driver = {group:id=>id===group.id?group:null,source:()=>group.sourceId,inspect:async()=>{calls.push('inspect');return{trusted:false};},verify:async()=>{calls.push('verify');},recognize:async()=>{calls.push('ocr');return{};},save:async(_capture,id,valid)=>{assert.ok(valid());calls.push(['save',id]);return{saved:true};}};
  return {group,driver,calls,session:new CurrentSession(driver)};
}
test('current-only calibration has no click entry; preserves old three-region configs',()=>{const group=config();assert.equal(group.regions.entry,undefined);assert.equal(groupConfig({...group,regions:{...group.regions,entry:{x:30,y:100,width:200,height:80}}}).regions.entry.width,200);});
test('current mode requires consent, selected source, calibration and exact ID',async()=>{const {session,group,driver}=setup();await assert.rejects(session.start({id:group.id,confirmed:false}),/确认/);await assert.rejects(session.start({id:'other',confirmed:true}),/校准/);driver.source=()=>null;await assert.rejects(session.start({id:group.id,confirmed:true}),/校准/);assert.equal(session.active,null);});
test('read-only current mode does not require control trust or activate/scroll',async()=>{const {session,group,calls}=setup();const s=await session.start({id:group.id,confirmed:true,frame:{}});await session.capture({id:group.id,token:s.token,frame:{}});assert.deepEqual(calls,['inspect','verify','inspect','verify','ocr',['save',group.id]]);});
test('session token cannot be reused for another conversation',async()=>{const {session,group,calls}=setup();const s=await session.start({id:group.id,confirmed:true});await assert.rejects(session.capture({id:'B',token:s.token}),/授权/);await assert.rejects(session.capture({id:group.id,token:'wrong'}),/授权/);assert.equal(calls.includes('ocr'),false);});
test('title mismatch invalidates the session before OCR or persistence',async()=>{const {session,group,driver,calls}=setup();const s=await session.start({id:group.id,confirmed:true});driver.verify=async()=>{throw new Error('标题不符');};await assert.rejects(session.capture({id:group.id,token:s.token}),/标题/);assert.equal(session.active,null);assert.equal(calls.includes('ocr'),false);});
test('window disappearance invalidates current session',async()=>{const {session,group,driver,calls}=setup();const s=await session.start({id:group.id,confirmed:true});driver.inspect=async()=>{throw new Error('窗口不可见');};await assert.rejects(session.capture({id:group.id,token:s.token}),/不可见/);assert.equal(session.active,null);assert.equal(calls.includes('ocr'),false);});
test('stop during start verification cannot create a late session',async()=>{const {session,group,driver}=setup();let release;driver.verify=()=>new Promise(r=>{release=r;});const pending=session.start({id:group.id,confirmed:true});await new Promise(r=>setImmediate(r));session.stop();release();await assert.rejects(pending,/已取消/);assert.equal(session.active,null);});
test('stop during OCR prevents all late writes; restart needs a new token',async()=>{const {session,group,driver,calls}=setup();const s=await session.start({id:group.id,confirmed:true});let release;driver.recognize=()=>new Promise(r=>{release=r;});const pending=session.capture({id:group.id,token:s.token});await new Promise(r=>setImmediate(r));session.stop();release({});await assert.rejects(pending,/未保存/);assert.ok(!calls.some(c=>Array.isArray(c)));const next=await session.start({id:group.id,confirmed:true});assert.notEqual(next.token,s.token);});
test('source change during start or OCR never authorizes another window',async()=>{const {session,group,driver,calls}=setup();const s=await session.start({id:group.id,confirmed:true});driver.recognize=async()=>{driver.source=()=> 'window:2:0';return{};};await assert.rejects(session.capture({id:group.id,token:s.token}),/未保存/);assert.ok(!calls.some(c=>Array.isArray(c)));});
test('pause during encryption preserves last good file and frame count',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sidecar-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'state'),{encode:s=>Buffer.from(s),decode:b=>b.toString()});const group=await store.saveGroup(config());const original=await fs.readFile(store.file);let release,valid=true;
  store.codec.encode=s=>new Promise(r=>{release=()=>r(Buffer.from(s));});
  const pending=store.addGroupCapture({id:'synthetic',imageHash:'synthetic'},group.id,'current',()=>valid);
  await new Promise(r=>setImmediate(r));valid=false;release();await assert.rejects(pending,/未保存/);assert.equal(store.snapshot().captures.length,0);assert.deepEqual(await fs.readFile(store.file),original);
});
const work={x:0,y:25,width:1440,height:875};
test('sidecar docks right without modifying target',()=>{const target={x:0,y:50,width:955,height:743};assert.deepEqual(dockBounds(target,work),{x:963,y:50,width:380,height:743});assert.equal(target.width,955);});
test('sidecar falls back left and supports negative monitor coordinates',()=>{assert.equal(dockBounds({x:450,y:100,width:900,height:700},work).x,62);assert.equal(dockBounds({x:-1440,y:0,width:900,height:800},{x:-1440,y:0,width:1440,height:900}).x,-532);});
test('insufficient room never overlays the chat and invalid coordinates rejected',()=>{assert.throws(()=>dockBounds({x:0,y:0,width:1440,height:800},work),/空间不足/);assert.throws(()=>dockBounds({x:NaN,y:0,width:900,height:800},work),/位置/);});
test('docking clamps vertically to work area',()=>{assert.deepEqual(dockBounds({x:0,y:0,width:900,height:1200},work),{x:908,y:25,width:380,height:875});});
function monitorDriver(){let clock=0;const log=[];const frame=async()=>({titleImage:'A',width:1000,height:800,clock:++clock});return{log,frame,probe:frame,start:async()=>({token:'T'}),capture:async()=>{log.push('capture');return{saved:true};},stop:async()=>{log.push('stop');}};}
test('current scheduler bounded run saves requested number and stops once',async()=>{const d=monitorDriver(),states=[];const m=new CurrentMonitor(d,s=>states.push(s));await m.start(config(),{intervalSeconds:2,count:1});assert.deepEqual(d.log,['capture','stop']);assert.equal(m.active,false);assert.match(states.at(-1).reason,/本轮完成/);});
test('stop while awaiting frame prevents any late capture',async()=>{const d=monitorDriver();let release;d.frame=()=>new Promise(r=>{release=r;});const m=new CurrentMonitor(d);const task=m.start(config(),{intervalSeconds:2,count:0});await m.stop();release({titleImage:'A'});await task;assert.deepEqual(d.log,['stop']);});
test('watcher pauses title change between scheduled captures',async()=>{const d=monitorDriver();d.probe=async()=>({titleImage:'B',width:1000,height:800,clock:2});const states=[];const m=new CurrentMonitor(d,s=>states.push(s));await m.start(config(),{intervalSeconds:60,count:0});assert.equal(d.log.filter(c=>c==='capture').length,1);assert.match(states.at(-1).reason,/标题/);assert.equal(m.active,false);});
test('scheduler rejects invalid bounds without starting',async()=>{for(const options of [{intervalSeconds:1,count:0},{intervalSeconds:2,count:51},{intervalSeconds:2,count:-1}]){const d=monitorDriver(),m=new CurrentMonitor(d);await assert.rejects(m.start(config(),options));assert.deepEqual(d.log,[]);}});
