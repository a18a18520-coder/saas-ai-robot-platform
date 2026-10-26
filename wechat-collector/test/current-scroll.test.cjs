'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CurrentSession } = require('../src/core/current-session.cjs');
const { CurrentMonitor } = require('../desktop/renderer/current-monitor.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const group = { id:'A',sourceId:'window:1:0',titleImageHash:'a'.repeat(64) }, log=[];
  const driver={group:id=>id==='A'?group:null,source:()=>group.sourceId,inspect:async()=>({trusted:true}),verify:async()=>log.push('verify'),trust:info=>{if(!info.trusted)throw Error('未授权');},focus:async()=>log.push('focus'),scroll:async(_g,d)=>log.push(d),recognize:async()=>({}),save:async()=>({saved:true})};
  const session=new CurrentSession(driver);
  const start=(extra={})=>session.start({id:'A',confirmed:true,frame:{},scroll:'up',scrollConfirmed:true,historyScreens:3,...extra});
  return {group,log,driver,session,start};
}
test('emergency shortcut must register before current session can focus a window',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  const code=source.slice(source.indexOf("  handle('current-start'"),source.indexOf("  handle('current-capture'"));
  for(const allowed of [false,true]){
    const calls=[];let start;
    const ctx={handle:(_name,fn)=>{start=fn;},busy:false,monitorGroups:null,pauseShortcut:'test',globalShortcut:{register:()=>{calls.push('register');return allowed;}},currentSession:{active:null,start:async()=>{calls.push('start');return {token:'synthetic'};}},stopMonitor:async()=>{calls.push('stop');}};
    vm.createContext(ctx);vm.runInContext(code,ctx);
    if(allowed){assert.equal((await start({})).token,'synthetic');assert.deepEqual(calls,['register','start']);}
    else{await assert.rejects(start({}),/快捷键/);assert.deepEqual(calls,['register','stop']);}
    assert.equal(ctx.busy,false);
  }
});
test('failed current start releases the shortcut and cancels pending control work',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');let handler,stops=0;
  const ctx={handle:(_name,fn)=>{handler=fn;},busy:false,monitorGroups:null,pauseShortcut:'test',globalShortcut:{register:()=>true},currentSession:{active:null,start:async()=>{throw Error('denied');}},stopMonitor:async()=>{stops++;}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf("  handle('current-start'"),source.indexOf("  handle('current-capture'")),ctx);
  await assert.rejects(handler({}),/denied/);assert.equal(stops,1);assert.equal(ctx.busy,false);
});
test('scroll requires separate consent and valid mode before focusing', async()=>{
  for(const options of [{scrollConfirmed:false},{scroll:'activate'},{historyScreens:0},{historyScreens:31},{historyScreens:1.2}]){const f=fixture();await assert.rejects(f.start(options));assert.deepEqual(f.log,[]);}
});
test('control denial never focuses or creates a scroll session',async()=>{const f=fixture();f.driver.inspect=async()=>({trusted:false});await assert.rejects(f.start(),/未授权/);assert.deepEqual(f.log,[]);assert.equal(f.session.active,null);});
test('focus is performed only after exact conversation verification',async()=>{const f=fixture();await f.start();assert.deepEqual(f.log,['verify','focus']);const bad=fixture();bad.driver.verify=async()=>{throw Error('标题不匹配');};await assert.rejects(bad.start(),/标题/);assert.deepEqual(bad.log,[]);});
test('pause during verification prevents late focus',async()=>{const f=fixture();f.driver.verify=async()=>f.session.stop();await assert.rejects(f.start(),/取消/);assert.deepEqual(f.log,[]);});
test('pause during focus cannot create a late token',async()=>{const f=fixture();f.driver.focus=async()=>f.session.stop();await assert.rejects(f.start(),/取消/);assert.equal(f.session.active,null);});
test('non-scrolling token cannot authorize any scrolling',async()=>{const f=fixture();const s=await f.start({scroll:'none'});await assert.rejects(f.session.scroll({id:'A',token:s.token,direction:'up',frame:{}}),/未授权/);assert.deepEqual(f.log,['verify']);});
test('scroll token is bound to one group and one direction',async()=>{const f=fixture();const s=await f.start();for(const args of [{id:'B',token:s.token,direction:'up'},{id:'A',token:'other',direction:'up'},{id:'A',token:s.token,direction:'down'},{id:'A',token:s.token,direction:'activate'}])await assert.rejects(f.session.scroll({...args,frame:{}}));assert.deepEqual(f.log,['verify','focus']);});
test('each scroll rechecks title before any mouse input',async()=>{const f=fixture();const s=await f.start();f.driver.verify=async()=>{throw Error('已换群');};await assert.rejects(f.session.scroll({...s,direction:'up',frame:{}}),/换群/);assert.equal(f.session.active,null);assert.ok(!f.log.includes('up'));});
test('revoked permissions stop scrolling immediately',async()=>{const f=fixture();const s=await f.start();f.driver.inspect=async()=>({trusted:false});await assert.rejects(f.session.scroll({...s,direction:'up',frame:{}}),/未授权/);assert.equal(f.session.active,null);assert.ok(!f.log.includes('up'));});
test('pause while checking a scroll prevents late native action',async()=>{const f=fixture();const s=await f.start();f.driver.verify=async()=>f.session.stop();await assert.rejects(f.session.scroll({...s,direction:'up',frame:{}}),/暂停/);assert.ok(!f.log.includes('up'));});
test('history screen cap is also enforced in the main-process session',async()=>{const f=fixture();const s=await f.start({historyScreens:2});await f.session.scroll({...s,direction:'up',frame:{}});await assert.rejects(f.session.scroll({...s,direction:'up',frame:{}}),/上限/);assert.equal(f.log.filter(x=>x==='up').length,1);});
test('source replacement invalidates the scroll token',async()=>{const f=fixture();const s=await f.start();f.driver.source=()=> 'window:2:0';await assert.rejects(f.session.scroll({...s,direction:'up',frame:{}}),/失效/);assert.ok(!f.log.includes('up'));});

function scheduler() {
  const log=[],states=[];let clock=0;
  const frame=async()=>({titleImage:'A',width:900,height:600,clock:++clock});
  const driver={frame,probe:frame,start:async(_g,_f,options)=>{log.push(['start',options]);return{token:'T'};},capture:async()=>{log.push('capture');return{saved:true,hash:String(clock)};},scroll:async(_g,_s,_f,d)=>log.push(d),stop:async()=>log.push('stop')};
  const monitor=new CurrentMonitor(driver,s=>states.push(s));return {driver,monitor,log,states};
}
test('history scheduler stops at cap and never scrolls after the last capture',async()=>{const f=scheduler();await f.monitor.start({id:'A'},{intervalSeconds:2,count:0,scroll:'up',scrollConfirmed:true,historyScreens:2});assert.equal(f.log.filter(x=>x==='capture').length,2);assert.equal(f.log.filter(x=>x==='up').length,1);assert.equal(f.log.at(-1),'stop');assert.match(f.states.at(-1).reason,/本轮完成/);});
test('unchanged history frame stops traversal early',async()=>{const f=scheduler();f.driver.capture=async()=>({saved:false,hash:'same'});await f.monitor.start({id:'A'},{intervalSeconds:2,count:0,scroll:'up',scrollConfirmed:true,historyScreens:10});assert.equal(f.log.filter(x=>x==='up').length,1);assert.match(f.states.at(-1).reason,/画面未再变化/);});
test('stop during frequency wait cancels pending scroll',async()=>{const f=scheduler();f.driver.capture=async()=>{queueMicrotask(()=>f.monitor.stop());return{saved:true};};await f.monitor.start({id:'A'},{intervalSeconds:2,count:0,scroll:'down',scrollConfirmed:true});assert.ok(!f.log.includes('down'));});
test('current scrolling has no group activation or direction escalation',async()=>{const f=scheduler();await f.monitor.start({id:'A'},{intervalSeconds:2,count:2,scroll:'down',scrollConfirmed:true});assert.equal(f.log.filter(x=>x==='down').length,1);assert.ok(!f.log.includes('activate')&&!f.log.includes('up'));assert.equal(f.log[0][1].scroll,'down');});
