// No .env, production proxy, tenant token or database. Only disposable fixtures.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const devices = [{ id:'synthetic-device', name:'Mac 合成采集助手', accountId:'synthetic-operator',status:'ACTIVE',createdAt:'2026-10-26T08:00:00Z' }];
const items = [
  {id:'synthetic-message-1',accountId:'synthetic-operator',deviceId:'synthetic-device',senderNickname:'示例甲',isSelf:false,identitySource:'visual_layout',content:'金额：1.2万元；已确认：否。',capturedAt:'2026-10-26T08:01:00Z',sentAtRaw:null,processingStatus:'collected',collectionId:'synthetic-collection',group:{id:'synthetic-group',name:'合成甲群',robotId:'synthetic-robot'}},
  {id:'synthetic-message-2',accountId:'synthetic-operator',deviceId:'synthetic-device',senderNickname:'合成本人',isSelf:true,identitySource:'manual_review',content:'事项：验收登录和同步；负责人：张三丰。',capturedAt:'2026-10-26T08:02:00Z',sentAtRaw:'今天 16:02',processingStatus:'awaiting_robot',collectionId:null,group:{id:'synthetic-group-2',name:'合成乙群'}}
];
const server = await createServer({configFile:false,envDir:false,root:fileURLToPath(new URL('../',import.meta.url)),define:{'import.meta.env.VITE_API_BASE':JSON.stringify('')},plugins:[react(),{
  name:'collector-isolated-fixture',configureServer(server){server.middlewares.use('/api/',(req,res)=>{
    res.setHeader('Content-Type','application/json');const path=req.url?.split('?')[0];let data;
    if(path==='/v1/tenant/collector/devices'&&req.method==='GET')data=devices;
    else if(path==='/v1/tenant/collector/messages'&&req.method==='GET')data={items,total:items.length,page:1};
    else if(path==='/v1/tenant/collector/devices/synthetic-device/revoke'&&req.method==='POST'){devices[0].status='REVOKED';data={revoked:true};}
    else if(path==='/v1/tenant/collector/messages/synthetic-message-2/process'&&req.method==='POST'){items[1].processingStatus='needs_review';items[1].collectionId='synthetic-reviewed';data={status:'received'};}
    else{res.statusCode=404;res.end(JSON.stringify({message:'Synthetic endpoints only'}));return;}
    res.end(JSON.stringify({code:0,data}));
  });}
}],server:{host:'127.0.0.1',port:5187,strictPort:true}});
await server.listen();console.log('Synthetic tenant collector UI: http://127.0.0.1:5187/test/fixtures/collector.html');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
