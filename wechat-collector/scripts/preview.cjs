'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createCapture, createReviewed } = require('../src/core/validation.cjs');
const { groupConfig, assertTitleMatch } = require('../src/core/groups.cjs');
const { rawExport } = require('../src/core/onboarding.cjs');
const renderer = path.resolve(__dirname, '../desktop/renderer');
const groups = ['甲', '乙'].map((label, index) => ({
  id: 'demo-' + index, name: '合成测试' + label + '群', sourceId: 'window:1:0', sourceName: '合成微信窗口（非真实）',
  geometry: { width: 900, height: 600 }, nativeSize: { width: 900, height: 600 },
  titleImageHash: 'a'.repeat(64), regions: { title: { x: 300, y: 15, width: 570, height: 60 }, messages: { x: 300, y: 100, width: 580, height: 380 }, entry: { x: 30, y: 100 + index * 100, width: 220, height: 80 } },
  historyScreens: 10, intervalSeconds: 30, chatId: null, channelId: null, progress: {}
}));
const state = { captures: [], records: [], groups: process.env.COLLECTOR_PREVIEW_EMPTY === '1' ? [] : structuredClone(groups) };
const syncState = { profile: null, bindings: [], messages: [], error: '', active: false };
let activeGroup = 0, sessionToken = null, sessionGroup = null, sessionScroll = 'none', remaining = 0, serial = 0, monitored = [];
const pages = [3,3];
function fixture() { return {index:activeGroup,page:pages[activeGroup]}; }
function scrollFixture(direction) { pages[activeGroup] = Math.max(0,Math.min(3,pages[activeGroup]+(direction==='up'?-1:1))); return {fixture:fixture()}; }
function captureFixture(group, frame, phase) {
  if(group?.name!==groups[activeGroup].name)throw new Error('合成会话已切换，未保存');
  const row=createCapture({dataURL:frame.messageImage,ocrText:(activeGroup?'示例乙：数量 3，确认：是。':'示例甲：金额 1.2 万元，确认：否。')+'\n合成历史第 '+pages[activeGroup]+' 屏',confidence:92,sourceName:'合成窗口'});
  row.group={id:group.id,name:group.name,chatId:null,channelId:null};row.phase=phase;
  const previous=state.captures.filter(item=>item.group?.id===group.id).at(-1);
  const result={hash:row.imageHash,saved:previous?.imageHash!==row.imageHash};if(result.saved)state.captures.push(row);return result;
}
const port = Number(process.env.COLLECTOR_PREVIEW_PORT || 5188);
const bridge = String.raw`'use strict';
document.getElementById('demo-banner').hidden = false;
document.getElementById('demo-banner').textContent = '合成桥接验收 · 不读取微信，不等于真机测试';
const request = async (method,args=[]) => { const response=await fetch('/fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})}); const result=await response.json();if(result.value?.fixture){fixtureIndex=result.value.fixture.index;fixturePage=result.value.fixture.page;paintFixture();}return result; };
const fixtureCanvas=document.createElement('canvas'); fixtureCanvas.width=900; fixtureCanvas.height=600;
let fixtureIndex=0, fixturePage=3, tick=0;
function paintFixture() {
  const ctx=fixtureCanvas.getContext('2d'); ctx.fillStyle='#f5f5f5'; ctx.fillRect(0,0,900,600);
  ctx.fillStyle='#1f2329'; ctx.font='28px sans-serif';ctx.fillText(fixtureIndex?'合成测试乙群':'合成测试甲群',310,55);
  ctx.font='22px sans-serif';ctx.fillText('合成测试甲群',30,140);ctx.fillText('合成测试乙群',30,240);
  ctx.fillText(fixtureIndex?'示例乙：数量 3，确认：是。':'示例甲：金额 1.2 万元，确认：否。',310,150);
  ctx.fillText('请核对原文，不补全身份和时间。',310,205);
  ctx.fillText('合成历史第 '+fixturePage+' 屏',310,255);
  ctx.fillStyle=tick++%2?'#eeeeee':'#ededed';ctx.fillRect(0,590,2,2);
}
paintFixture(); setInterval(paintFixture,250);
Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>fixtureCanvas.captureStream(4)});
const demoSwitch=document.createElement('button');demoSwitch.textContent='切换合成会话（测试暂停）';
demoSwitch.addEventListener('click',async()=>{await request('fixtureSwitch');});
document.getElementById('demo-banner').append(demoSwitch);
window.collector=Object.fromEntries(['tenantLogin','tenantLogout','tenantState','tenantGroups','tenantBind','tenantFlush','tenantReview','tenantDiscard','tenantMore','info','sources','state','getCapture','review','export','clear','stop','send','select','capture','importImage','currentStart','currentCapture','currentStop','currentScroll','permissionStatus','controlStatus','monitorStart','monitorStop','monitorAction','monitorCapture','monitorProgress','dock','saveGroup','wechatSources','setupLayout','rebindGroup','exportRaw','openScreenSettings'].map(method=>[method,(...args)=>request(method,method==='importImage'?[fixtureCanvas.toDataURL('image/png')]:method==='tenantLogin'?[{...args[0],image:fixtureCanvas.toDataURL('image/png')}]:args)]));
`;
const server = http.createServer(async (req,res) => {
  try {
    if (req.headers.host !== '127.0.0.1:' + port) { res.writeHead(403); return res.end(); }
    if (req.url === '/fixture' && req.method === 'POST') {
      if (req.headers.origin !== 'http://127.0.0.1:' + port) { res.writeHead(403); return res.end(); }
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2000000){res.writeHead(413);return res.end();}chunks.push(chunk);}
      const {method,args}=JSON.parse(Buffer.concat(chunks).toString());let value;
      if(method==='info')value={platform:'preview',version:require('../package.json').version,encrypted:false,ready:true};
      else if(method==='tenantLogin') {
        syncState.profile={tenantId:'demo-tenant',tenantName:'合成演示租户',accountId:'demo-user',account:'合成操作员',origin:'http://127.0.0.1:合成服务',deviceId:'demo-device'};
        const c=createCapture({dataURL:args[0].image,ocrText:'合成测试消息',confidence:85,sourceName:'合成窗口'});state.captures.push(c);
        syncState.messages=[{id:'demo-message',captureId:c.id,localGroupId:'demo-0',localName:'合成测试甲群',senderNickname:'示例甲',isSelf:false,content:'金额：1.2万元；已确认：否。',state:'pending_review',reason:'合成待核对示例：发送人识别质量不足'}];value=syncState;
      }
      else if(method==='tenantLogout'){syncState.profile=null;value={...syncState,messages:[],bindings:[]};}
      else if(method==='tenantState')value=syncState.profile?syncState:{...syncState,messages:[],bindings:[]};
      else if(method==='tenantGroups')value=[{id:'remote-demo',name:'合成测试甲群',status:'BOUND'}];
      else if(method==='tenantBind') {
        const input=args[0],g=state.groups.find(g=>g.id===input.localGroupId);if(!g||!input.confirmed)throw new Error('请确认会话和同步范围');
        syncState.bindings=[{...input,localName:g.name,groupId:'remote-demo',bindingId:'binding-demo',remoteName:'合成测试甲群',remoteEnabled:input.enabled}];value=syncState;
      }
      else if(method==='tenantFlush'){for(const m of syncState.messages)if(m.state==='ready'){m.state='synced';m.receipt={processingStatus:'collected'};}value=syncState;}
      else if(method==='tenantReview'){const m=syncState.messages.find(m=>m.id===args[0]);if(!m||!args[1].confirmed)throw new Error('请核对');Object.assign(m,args[1],{state:'ready',reason:''});value=syncState;}
      else if(method==='tenantDiscard'){syncState.messages.find(m=>m.id===args[0]).state='ignored';value=syncState;}
      else if(method==='tenantMore')throw new Error('合成预览仅演示一条；真实桌面版支持同图补录');
      else if(method==='permissionStatus')value={available:true,trusted:true};
      else if(method==='sources'||method==='wechatSources')value=[{id:'window:1:0',name:'合成微信窗口（非真实）'}];
      else if(method==='setupLayout')value=true;
      else if(method==='saveGroup'){
        const group=groupConfig({...args[0].config,titleImageHash:'a'.repeat(64),nativeSize:{width:900,height:600}});
        assertTitleMatch(group.name,{ocrText:groups[activeGroup].name,confidence:92});
        const index=state.groups.findIndex(row=>row.id===group.id);
        if(index<0)state.groups.push(group);else state.groups[index]=group;
        value=group;
      }
      else if(method==='rebindGroup'){
        const group=state.groups.find(row=>row.id===args[0].id);
        if(!group||args[0].confirmed!==true)throw new Error('请先确认合成目标会话');
        assertTitleMatch(group.name,{ocrText:groups[activeGroup].name,confidence:92});
        value=group;
      }
      else if(method==='exportRaw'){rawExport(state,args[0]);throw new Error('合成验收不写文件。正式桌面版会打开明文原文的保存对话框。');}
      else if(method==='select')value={id:'window:1:0',name:'合成微信窗口（非真实）'};
      else if(method==='state')value={...state,captures:state.captures.map(({image,ocrText,...item})=>item)};
      else if(method==='getCapture')value=state.captures.find(item=>item.id===args[0]);
      else if(method==='fixtureSwitch'){activeGroup=1-activeGroup;value={fixture:fixture()};}
      else if(method==='currentStart'){
        sessionGroup=state.groups.find(row=>row.id===args[0]?.id);
        if(args[0]?.confirmed!==true||sessionGroup?.name!==groups[activeGroup].name)throw new Error('合成会话标题不匹配，未启动');
        sessionScroll=args[0].scroll||'none';remaining=(args[0].historyScreens||10)-1;
        if(!['none','up','down'].includes(sessionScroll)||(sessionScroll!=='none'&&args[0].scrollConfirmed!==true))throw new Error('未确认合成滚动');
        sessionToken='synthetic-'+(++serial);value={token:sessionToken,id:sessionGroup.id};
      } else if(method==='currentCapture'){
        const group=sessionGroup;
        if(!sessionToken||args[0]?.token!==sessionToken||args[0]?.id!==group?.id||group.name!==groups[activeGroup].name)throw new Error('合成会话已切换，未保存');
        value=captureFixture(group,args[0].frame,'current');
      } else if(method==='currentScroll'){
        if(!sessionToken||args[0].token!==sessionToken||args[0].id!==sessionGroup?.id||sessionGroup.name!==groups[activeGroup].name||sessionScroll==='none'||args[0].direction!==sessionScroll)throw new Error('合成滚动身份不匹配');
        if(sessionScroll==='up'&&remaining--<=0)throw new Error('到达历史上限');
        value=scrollFixture(sessionScroll);
      } else if(method==='currentStop'||method==='stop'||method==='monitorStop'){sessionToken=null;monitored=[];value=true;}
      else if(method==='controlStatus')value={checked:true,trusted:true,platform:'preview',componentPath:'仅合成驱动，不提供真实界面控制'};
      else if(method==='monitorStart'){
        if(args[0].confirmed!==true||!args[0].ids?.length||args[0].ids.some(id=>!state.groups.find(row=>row.id===id)?.regions.entry))throw new Error('请确认轮巡会话和入口');
        monitored=[...args[0].ids];value=true;
      } else if(['monitorAction','monitorCapture','monitorProgress'].includes(method)){
        const group=state.groups.find(row=>row.id===args[0].id);
        if(!group||!monitored.includes(group.id))throw new Error('会话不在本次合成轮巡范围');
        if(method==='monitorCapture')value=captureFixture(group,args[0].frame,args[0].phase);
        else if(method==='monitorProgress'){group.progress={...group.progress,...args[0].progress};value=group.progress;}
        else if(args[0].action==='activate'){activeGroup=groups.findIndex(row=>row.name===group.name);if(activeGroup<0)throw new Error('合成会话不存在');value={fixture:fixture()};}
        else if(['up','down'].includes(args[0].action)&&group.name===groups[activeGroup].name)value=scrollFixture(args[0].action);
        else throw new Error('未允许的合成操作');
      }
      else if(method==='importImage'){value=createCapture({dataURL:args[0],ocrText:'金额：1.2万元；已确认：否。\n设备编号：DEVICE-DEMO-17',confidence:92,sourceName:'合成导入截图'});state.captures.push(value);}
      else if(method==='review'){value=createReviewed(state.captures.find(item=>item.id===args[0]),args[1]);state.records.push(value);}
      else if(method==='export')throw new Error('验收模式不写文件；桌面应用会打开保存对话框。');
      else if(method==='clear'){state.captures=[];state.records=[];value=true;}
      else throw new Error('合成预览不移动真实窗口、不发送、不连接平台。');
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,value}));
    }
    const allowed={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/tenant-sync.js':'tenant-sync.js','/app.js':'app.js','/monitor.js':'monitor.js','/monitor-ui.js':'monitor-ui.js','/current-monitor.js':'current-monitor.js','/sidecar.js':'sidecar.js','/flow-state.js':'flow-state.js','/onboarding.js':'onboarding.js','/preview-bridge.js':'preview-bridge.js'};
    if(req.method!=='GET'||!allowed[req.url]){res.writeHead(404);return res.end();}
    const name=allowed[req.url];let body=name==='preview-bridge.js'?bridge:await fs.readFile(path.join(renderer,name),'utf8');if(name==='index.html')body=body.replace("connect-src 'none'","connect-src 'self'");
    res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript');res.end(body);
  } catch(error) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log('Synthetic UI verification only: http://127.0.0.1:'+port));
