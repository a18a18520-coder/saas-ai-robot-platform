'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { groupConfig, titleMatches, assertTitleMatch } = require('../src/core/groups.cjs');
const { Store } = require('../src/core/store.cjs');
const { createCapture } = require('../src/core/validation.cjs');
const { WindowControl } = require('../src/core/window-control.cjs');
const { GroupMonitor } = require('../desktop/renderer/monitor.js');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const input = (name = '合成测试甲群') => ({ name, sourceId:'window:123:0',sourceName:'微信',geometry:{width:1000,height:800},regions:{entry:{x:50,y:100,width:200,height:80},title:{x:300,y:30,width:400,height:50},messages:{x:300,y:100,width:650,height:500}},historyScreens:10,intervalSeconds:30,nativeSize:{width:1000,height:800},titleImageHash:'a'.repeat(64) });
const capture = () => createCapture({dataURL:png,ocrText:'合成消息，金额 1.2 万元；确认：否。',confidence:90,sourceName:'合成窗口'});
const codec = {encode:text=>Buffer.from(text),decode:bytes=>bytes.toString()};
async function storeFor(t) { const dir=await fs.mkdtemp(path.join(os.tmpdir(),'collector-groups-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return new Store(path.join(dir,'test.enc'),codec); }

test('group config keeps all three regions and bounded schedule',()=>{const row=groupConfig(input());assert.equal(row.historyScreens,10);assert.equal(row.intervalSeconds,30);assert.equal(row.titleImageHash,'a'.repeat(64));assert.equal(row.chatId,null);assert.ok(row.id);});
for (const invalid of [null,{historyScreens:-1},{historyScreens:31},{historyScreens:1.5},{intervalSeconds:9},{intervalSeconds:3601},{name:'..'},{name:'短'},{sourceId:'screen:0:0'},{regions:{}},{geometry:{width:0,height:800}}]) test('invalid group config rejected: '+JSON.stringify(invalid),()=>assert.throws(()=>groupConfig(invalid===null?null:{...input(),...invalid})));
test('entry/title may not overlap message area or right side',()=>{for(const regions of [{entry:{x:400,y:100,width:100,height:80}},{title:{x:300,y:50,width:400,height:80}},{entry:{x:100,y:100,width:500,height:80}}])assert.throws(()=>groupConfig({...input(),regions:{...input().regions,...regions}}));});
test('title matching is not substring or fuzzy; member counts and spaces are normalized',()=>{assert.ok(titleMatches('合成甲群','合成 甲群（123）'));assert.ok(titleMatches('合成👑甲群','合成甲群'));for(const observed of ['合成乙群','合成甲群通知','合成…','合成甲群(3)还有文字',''])assert.equal(titleMatches('合成甲群',observed),false);});
test('two groups keep identical frames separate and review cannot change group',async t=>{const store=await storeFor(t),a=await store.saveGroup(input()),b=await store.saveGroup(input('合成测试乙群'));const ca=capture(),cb=capture();await store.addGroupCapture(ca,a.id,'history');await store.addGroupCapture(cb,b.id,'history');assert.equal(store.snapshot().captures.length,2);assert.notDeepEqual(store.snapshot().captures[0].group,store.snapshot().captures[1].group);await assert.rejects(store.review(ca.id,{confirmed:true,content:'合成',chatLabel:b.name}),/群归属/);const record=await store.review(ca.id,{confirmed:true,content:'合成',chatLabel:a.name});assert.equal(record.group.id,a.id);assert.equal(record.chatId,null);});
test('frame suppression is scoped to group and maintains last observed frame after history return',async t=>{const store=await storeFor(t),a=await store.saveGroup(input()),b=await store.saveGroup(input('合成测试乙群'));const first=capture(),older={...capture(),imageHash:'different-synthetic-frame'};assert.equal((await store.addGroupCapture(first,a.id,'history')).saved,true);await store.addGroupCapture(older,a.id,'history');assert.equal((await store.addGroupCapture(first,a.id,'history-return')).saved,false);assert.equal((await store.addGroupCapture(first,a.id,'new')).saved,false);assert.equal((await store.addGroupCapture(first,b.id,'new')).saved,true);assert.equal(store.snapshot().captures.length,3);});
test('group identity immutable; recalibration retains progress and reload isolates it',async t=>{const store=await storeFor(t),a=await store.saveGroup(input()),b=await store.saveGroup(input('合成测试乙群'));await store.groupProgress(a.id,{historyDone:true});await assert.rejects(store.saveGroup({...a,name:'替换测试群'}),/身份/);await assert.rejects(store.saveGroup({...a,chatId:'other'}),/身份/);await store.saveGroup({...a,intervalSeconds:60});const reload=new Store(store.file,codec);await reload.load();assert.equal(reload.snapshot().groups.find(g=>g.id===a.id).progress.historyDone,true);assert.equal(reload.snapshot().groups.find(g=>g.id===b.id).progress.historyDone,false);});
test('confusable group names cannot coexist',async t=>{const store=await storeFor(t);await store.saveGroup(input('合成👑测试群'));await assert.rejects(store.saveGroup(input('合成测试群')),/无法区分/);});
test('manual review can supply missing platform IDs but cannot overwrite known binding or provenance',async t=>{const store=await storeFor(t),a=await store.saveGroup(input()),b=await store.saveGroup({...input('绑定合成乙群'),chatId:'group-b',channelId:'account-b'});const ca=capture(),cb=capture();await store.addGroupCapture(ca,a.id,'new');await store.addGroupCapture(cb,b.id,'new');const record=await store.review(ca.id,{confirmed:true,content:'合成',chatLabel:a.name,chatId:'group-a',channelId:'account-a'});assert.equal(record.chatId,'group-a');assert.equal(record.group.chatId,null);assert.equal(store.snapshot().captures[0].group.chatId,null);await assert.rejects(store.review(cb.id,{confirmed:true,content:'合成',chatLabel:b.name,chatId:'group-a',channelId:'account-b'}),/群归属/);});
test('version 1 migration retains existing records and clears history progress only on explicit clear',async t=>{const store=await storeFor(t);await fs.writeFile(store.file,JSON.stringify({version:1,captures:[capture()],records:[]}));await store.load();assert.deepEqual(store.snapshot().groups,[]);assert.equal(store.snapshot().captures.length,1);const a=await store.saveGroup(input());await store.groupProgress(a.id,{historyDone:true});await store.clear();assert.equal(store.snapshot().groups.length,1);assert.equal(store.snapshot().groups[0].progress.historyDone,false);assert.equal(store.snapshot().captures.length,0);});

const fixtureGroups = ()=>[{...groupConfig(input()),id:'A'},{...groupConfig(input('合成测试乙群')),id:'B'}];
function driverFor() { const log=[]; let frameNo=0;return {log,activate:async g=>{log.push(['activate',g.id]);},frame:async g=>({id:g.id,hash:String(++frameNo)}),capture:async(g,f,phase)=>{log.push(['capture',g.id,phase]);return{hash:f.hash,saved:true};},scroll:async(g,d)=>{log.push([d,g.id]);},progress:async(g,p)=>{log.push(['progress',g.id,p]);}}; }
test('history limit and independent group progress; no concurrent visits',async()=>{const d=driverFor(),groups=fixtureGroups();let monitor;monitor=new GroupMonitor(d,states=>{if(states.B?.phase==='waiting'&&states.B.historyDone)monitor.stop();});await monitor.start(groups);for(const g of groups){assert.equal(d.log.filter(x=>x[0]==='up'&&x[1]===g.id).length,9);assert.equal(d.log.filter(x=>x[0]==='capture'&&x[1]===g.id&&x[2]==='history').length,10);assert.equal(d.log.filter(x=>x[0]==='down'&&x[1]===g.id).length,19);}assert.ok(d.log.findIndex(x=>x[0]==='progress'&&x[1]==='A')<d.log.findIndex(x=>x[0]==='activate'&&x[1]==='B'));});
test('unchanged frames stop upward scrolling early and avoid unbounded loops',async()=>{const d=driverFor();d.capture=async()=>({hash:'same',saved:false});const groups=fixtureGroups().slice(0,1);let monitor;monitor=new GroupMonitor(d,s=>{if(s.A?.historyDone)monitor.stop();});await monitor.start(groups);assert.equal(d.log.filter(x=>x[0]==='up').length,1);assert.equal(d.log.filter(x=>x[0]==='down').length,2);});
test('zero history and persisted progress never scroll upward',async()=>{for(const group of [{...fixtureGroups()[0],historyScreens:0},{...fixtureGroups()[0],progress:{historyDone:true}}]){const d=driverFor();let monitor;monitor=new GroupMonitor(d,s=>{if(s.A?.checkedAt)monitor.stop();});await monitor.start([group]);assert.equal(d.log.filter(x=>x[0]==='up').length,0);}});
test('one bad title pauses that group; other group continues independently',async()=>{const d=driverFor();const base=d.capture;d.capture=async(g,...args)=>{if(g.id==='A')throw new Error('群名不匹配');return base(g,...args);};let monitor;monitor=new GroupMonitor(d,s=>{if(s.B?.historyDone)monitor.stop();});await monitor.start(fixtureGroups());assert.equal(monitor.states.A.phase,'paused');assert.equal(monitor.states.A.saved,0);assert.ok(d.log.some(x=>x[0]==='capture'&&x[1]==='B'));assert.ok(!d.log.some(x=>x[0]==='up'&&x[1]==='A'));});
test('all groups paused ends run without spinning',async()=>{const d=driverFor();d.activate=async()=>{throw new Error('窗口不可用');};const m=new GroupMonitor(d);await m.start(fixtureGroups());assert.equal(m.active,false);assert.ok(Object.values(m.states).every(s=>s.phase==='paused'));});
test('stop while awaiting frame prevents late capture and all later UI operations',async()=>{const d=driverFor();let release,entered;const frameStarted=new Promise(r=>entered=r);d.frame=()=>new Promise(r=>{release=r;entered();});const m=new GroupMonitor(d),pending=m.start(fixtureGroups());await frameStarted;m.stop();release({hash:'late'});await pending;assert.deepEqual(d.log,[['activate','A']]);});
test('stop wakes idle polling promptly and refuses duplicate active run',async()=>{const d=driverFor();d.capture=async()=>({hash:'same',saved:false});let ready;const waiting=new Promise(r=>ready=r);const m=new GroupMonitor(d,s=>{if(s.A?.checkedAt)ready();});const run=m.start(fixtureGroups().slice(0,1));await waiting;await assert.rejects(m.start(fixtureGroups()),/已在运行/);m.stop();await run;assert.equal(m.active,false);});

test('native bridge restricts commands, source and coordinates before spawning',async()=>{let calls=0;const c=new WindowControl('/synthetic',{platform:'darwin',execute:()=>{calls++;}});for(const [id,action,g,r]of[['screen:0:0','inspect'],['window:1:0','send'],['window:1:0','activate',input().geometry,{x:600,y:0,width:50,height:50}],['window:1:0','down',input().geometry,{x:0,y:0,width:0,height:20}]])await assert.rejects(c.run(id,action,g,r));assert.equal(calls,0);});
test('native bridge serializes work, sends JSON only, kills active job and surfaces safe error',async()=>{let finish,payload,killed=false;const c=new WindowControl('/synthetic',{platform:'darwin',execute:(command,args,options,callback)=>{assert.match(command,/wechat-control-/);assert.deepEqual(args,[]);assert.equal(options.timeout,8000);finish=callback;return{stdin:{on(){},end(text){payload=JSON.parse(text);}},kill(){killed=true;}};}});const pending=c.run('window:123:0','activate',input().geometry,input().regions.entry);await assert.rejects(c.run('window:123:0','inspect'),/尚未结束/);assert.equal(payload.windowId,'123');assert.equal(payload.x,.15);c.stop();assert.equal(killed,true);finish(new Error('private-error'),'not JSON');await assert.rejects(pending,e=>!e.message.includes('private-error')&&/不可用/.test(e.message));assert.equal(c.child,null);});

test('null/zero ROI rejected; title-first calibration no longer dereferences missing message ROI',async()=>{const source=await fs.readFile(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');const code=source.slice(source.indexOf('function updateRegion('),source.indexOf('\nfunction freeze('));const elements={'roi-purpose':{value:'title'},'capture-consent':{}};const context={frozen:{width:1000,height:800},calibration:{},previewROI:null,roi:null,$:id=>elements[id]??=( {} ),status(){},draw(){},controls(){}};vm.createContext(context);vm.runInContext(code,context);assert.throws(()=>context.updateRegion(null),/有效矩形/);assert.throws(()=>context.updateRegion({x:0,y:0,width:0,height:40}),/有效矩形/);context.updateRegion({x:300,y:20,width:400,height:50});assert.equal(context.roi,null);assert.equal(context.calibration.title.width,400);assert.equal(elements['roi-width'].value,'400');});

test('changed title pixels fail closed even when text normalization would match',async()=>{const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');const code=source.slice(source.indexOf('async function verifyTitle('),source.indexOf('\nfunction snapshot('));const ctx={pngBytes:require('../src/core/validation.cjs').pngBytes,createHash:require('node:crypto').createHash,nativeImage:{createFromBuffer:()=>({getSize:()=>({width:400,height:50})})},ocr:{recognize:async()=>({confidence:95,ocrText:'合成测试甲群'})},assertTitleMatch};vm.createContext(ctx);vm.runInContext(code,ctx);const g=groupConfig(input()),frame={width:1000,height:800,titleImage:png};await assert.rejects(ctx.verifyTitle(g,frame),/标题画面已变化/);const hash=await ctx.verifyTitle({...g,titleImageHash:null},frame);assert.equal(hash.length,64);assert.equal(await ctx.verifyTitle({...g,titleImageHash:hash},frame),hash);ctx.ocr.recognize=async()=>({confidence:30,ocrText:g.name});await assert.rejects(ctx.verifyTitle({...g,titleImageHash:hash},frame),/识别不清/);});

test('title diagnostics explain the observed text without accepting OCR errors',()=>{
  assert.doesNotThrow(()=>assertTitleMatch('合成👑甲群',{confidence:90,ocrText:'合成甲群(68)'}));
  assert.throws(()=>assertTitleMatch('合成👑甲群',{confidence:90,ocrText:'合成王甲群(68)'}),/识别：合成王甲群\(68\).*90%/);
  for(const confidence of [64,NaN,undefined,'99']) assert.throws(()=>assertTitleMatch('合成甲群',{confidence,ocrText:'合成甲群'}),/未保存消息/);
});

test('control readiness is based on the native helper and fails closed',()=>{
  const control=new WindowControl('/synthetic',{platform:'darwin'});
  for(const value of [null,{}, {trusted:false}, {trusted:'true'}]) assert.throws(()=>control.assertTrusted(value),/控制组件未获系统授权/);
  assert.doesNotThrow(()=>control.assertTrusted({trusted:true}));
  assert.equal(control.componentPath,path.join('/synthetic',`wechat-control-${process.arch}`));
});

test('monitor start preflights helper trust before registering or activating',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  const code=source.slice(source.indexOf("  handle('monitor-start'"),source.indexOf("  handle('monitor-stop'"));
  let start, registered=0;
  const group=groupConfig(input());
  const ctx={handle:(name,fn)=>{start=fn;},busy:false,currentSession:{active:null},monitorGroups:null,generation:0,selected:{id:group.sourceId},snapshot:()=>({groups:[group]}),ensureWindow:async()=>({trusted:false}),control:new WindowControl('/synthetic',{platform:'darwin'}),globalShortcut:{register:()=>{registered++;return true;}},pauseShortcut:'test',stopMonitor:async()=>{}};
  vm.createContext(ctx); vm.runInContext(code,ctx);
  await assert.rejects(start({ids:[group.id],confirmed:true}),/控制组件未获系统授权/);
  assert.equal(registered,0); assert.equal(ctx.monitorGroups,null); assert.equal(ctx.busy,false);
});

test('permission UI never substitutes parent permission for helper readiness',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/renderer/monitor-ui.js'),'utf8');
  const code=source.slice(source.indexOf('window.resetControlStatus ='),source.indexOf("action('check-control'"));
  const elements={}; let result={checked:true,trusted:false,componentPath:'/synthetic/helper'};
  const ctx={window:{},controlReady:true,checkingControl:false,$:id=>elements[id]??={},controls(){},api:async()=>result};
  vm.createContext(ctx); vm.runInContext(code,ctx);
  await ctx.window.refreshControlStatus(); assert.equal(ctx.controlReady,false); assert.match(elements['monitor-permission'].textContent,/尚未获系统授权/);
  result={checked:true,trusted:true}; await ctx.window.refreshControlStatus(); assert.equal(ctx.controlReady,true);
  ctx.window.resetControlStatus(); assert.equal(ctx.controlReady,false);
  ctx.api=async()=>{throw new Error('synthetic inspection failure');}; await ctx.window.refreshControlStatus(); assert.equal(ctx.controlReady,false); assert.equal(ctx.checkingControl,false);
});

test('all-paused completion replaces the stale started banner',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/renderer/monitor-ui.js'),'utf8');
  const code=source.slice(source.indexOf("action('monitor-start'"),source.indexOf("action('monitor-stop'"));
  let start; const messages=[],elements={'monitor-consent':{checked:true},interval:{value:'30'},'rotation-history':{value:'10'}};
  const ctx={action:(name,fn)=>{start=fn;},monitorTask:null,monitorBusy:false,stoppingMonitor:false,working:false,controlReady:true,window:{collectorMonitorActive:()=>false,isRotationEnabled:()=>true,selectedMonitorGroups:()=>[{id:'A'}]},groups:[{id:'A'}],groupStates:{A:{phase:'paused'}},stream:{},structuredClone,controls(){},status:(...args)=>messages.push(args),$:id=>elements[id]??={},api:async()=>true,groupMonitor:{start:async()=>{}},lastGroupData:null};
  vm.createContext(ctx);vm.runInContext(code,ctx);await start();await ctx.monitorTask;
  assert.match(messages.at(-1)[0],/所有目标群均已暂停/);assert.equal(messages.at(-1)[1],true);assert.equal(elements['monitor-state'].textContent,'已停止');
});
test('rotation uses explicit run settings without rewriting saved group configuration',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/renderer/monitor-ui.js'),'utf8');
  const code=source.slice(source.indexOf("action('monitor-start'"),source.indexOf("action('monitor-stop'"));
  for(const interval of ['10','9','2.5']){
    const selected=[{id:'A',intervalSeconds:45,historyScreens:8}],elements={interval:{value:interval},'rotation-history':{value:'2'},'monitor-consent':{checked:true}};
    let start,run;const calls=[];
    const ctx={action:(_id,fn)=>{start=fn;},monitorTask:null,monitorBusy:false,stoppingMonitor:false,working:false,controlReady:true,window:{collectorMonitorActive:()=>false,isRotationEnabled:()=>true,selectedMonitorGroups:()=>selected},groupStates:{},stream:{},structuredClone,controls(){},status(){},$:id=>elements[id]??={},api:async(method,args)=>{calls.push([method,args]);return true;},groupMonitor:{start:async groups=>{run=groups;}},lastGroupData:null};
    vm.createContext(ctx);vm.runInContext(code,ctx);
    if(interval==='10') { await start();await ctx.monitorTask;assert.equal(run[0].intervalSeconds,10);assert.equal(run[0].historyScreens,2);assert.equal(elements['monitor-consent'].checked,false); }
    else { await assert.rejects(start(),/轮巡间隔/);assert.deepEqual(calls,[]); }
    assert.deepEqual(selected,[{id:'A',intervalSeconds:45,historyScreens:8}]);
  }
});
