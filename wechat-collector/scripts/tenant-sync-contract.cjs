'use strict';
// Real Nest HTTP/controller/guard/service + local client. In-memory DB, synthetic
// login issuer and model: never load .env, real tenant rows or provider credentials.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { TenantSync } = require('../src/core/tenant-sync.cjs');
const { Store } = require('../src/core/store.cjs');

async function main() {
  if (!process.argv[2]) throw Error('Pass the local platform repository path');
  const backend = path.resolve(process.argv[2], 'backend'), pr = createRequire(path.join(backend, 'package.json'));
  pr('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
  const { Test } = pr('@nestjs/testing'), { Controller, Post, Body, UnauthorizedException } = pr('@nestjs/common');
  const load = f => require(path.join(backend, 'src', f));
  const { ApiAuthGuard } = load('auth/api-auth.guard.ts'), { TransformInterceptor } = load('common/interceptors/transform.interceptor.ts');
  const { CollectorController } = load('collector/collector.controller.ts'), { CollectorService, collectorPayload } = load('collector/collector.service.ts');
  const { CollectorDevice, CollectorBinding, CollectorMessage } = load('collector/collector.entity.ts');
  const { Tenant } = load('tenants/tenant.entity.ts'), { TenantAccount } = load('tenants/tenant-account.entity.ts');
  const { Robot } = load('robots/robot.entity.ts'), { Group } = load('groups/group.entity.ts'), { CollectionRecord } = load('robots/collection-record.entity.ts');
  const { CollectionService } = load('ai-router/collection.service.ts');
  const tables = new Map(), repos = new Map();
  const table = T => { if (!tables.has(T)) tables.set(T, []); return tables.get(T); };
  const matches = (row, where = {}) => Object.entries(where).every(([k,v]) => row[k] === v);
  const unique = (T,a,b) => (T === CollectorDevice ? ['tenantId','accountId','installationId'] : T === CollectorBinding ? ['deviceId','localGroupId'] : T === CollectorMessage ? ['deviceId','sourceMessageId'] : T === CollectionRecord ? ['tenantId','robotId','eventKey'] : ['id']).every(k => a[k] === b[k]);
  const repo = T => {
    if (repos.has(T)) return repos.get(T);
    const r = {
      create: input => Object.assign(new T(), { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), status: 'ACTIVE', processingStatus: 'received' }, structuredClone(input)),
      save: async row => { const at = table(T).findIndex(x => x.id === row.id); if (at < 0) table(T).push(structuredClone(row)); else table(T)[at] = structuredClone(row); return row; },
      find: async (o = {}) => structuredClone(table(T).filter(x => matches(x,o.where)).slice(o.skip || 0, (o.skip || 0) + (o.take || 1000))),
      findOne: async o => { const row=table(T).find(x => matches(x,o.where)); return row ? Object.assign(new T(),structuredClone(row)) : null; },
      findOneOrFail: async o => { const row = await r.findOne(o); if (!row) throw Error('Fixture row not found'); return row; },
      findAndCount: async o => [await r.find(o), table(T).filter(x => matches(x,o.where)).length],
      update: async (where, update) => { for (const row of table(T).filter(x => matches(x,where))) Object.assign(row,update); },
      createQueryBuilder: () => {
        let row, params;
        const q = { insert: () => q, into: () => q, values: v => { row = r.create(v); return q; }, orIgnore: () => q, returning: () => q,
          where: (_sql,p) => { params = p; return q; }, getMany: async () => structuredClone(table(T).filter(x => x.tenantId === params.tenant && x.deviceId === params.device && params.ids.includes(x.sourceMessageId))),
          execute: async () => { if (table(T).some(x => unique(T,x,row))) return { raw: [] }; await r.save(row); return { raw:[{id:row.id}] }; } }; return q;
      }
    }; repos.set(T,r); return r;
  };
  const manager = { findOne: (T,o) => repo(T).findOne(o), create:(T,o) => repo(T).create(o), save: (T,o) => o ? repo(T).save(o) : repo(T.constructor).save(T), update:(T,w,o) => repo(T).update(w,o) };
  let tail = Promise.resolve();
  const db = { getRepository: repo, transaction: f => { const run = tail.then(() => f(manager)); tail = run.catch(() => {}); return run; } };
  const tenantId = randomUUID(), otherTenant = randomUUID(), accountId = randomUUID(), otherAccount = randomUUID(), operatorId = randomUUID();
  await repo(Tenant).save(repo(Tenant).create({ id:tenantId,name:'合成租户甲',status:'ACTIVE' }));
  await repo(Tenant).save(repo(Tenant).create({ id:otherTenant,name:'合成租户乙',status:'ACTIVE' }));
  await repo(TenantAccount).save(repo(TenantAccount).create({ id:accountId,tenantId,account:'synthetic-admin',name:'测试操作员',status:'ACTIVE' }));
  const config = { trigger:'all',prompt:'仅记录原文明示内容',constraints:'不得推测',keywords:[],fields:[
    {key:'amount',label:'金额',type:'number',required:true,description:'',rules:{sourceLabel:'金额',sourceUnit:'万元',multiplier:10000}},
    {key:'confirmed',label:'已确认',type:'boolean',required:true,description:'',rules:{sourceLabel:'已确认'}}
  ] };
  const robot = repo(Robot).create({ tenantId,status:'PUBLISHED',publishedConfig:{ragConfig:{mode:'collector',collection:config}},ragConfig:{mode:'qa'} }); await repo(Robot).save(robot);
  let modelCalls = 0, identityCalls = 0, wrongType = false;
  const models = { tenantPolicy: async () => ({primaryModelId:'synthetic'}), generate: async () => { modelCalls++; return {modelId:'synthetic',text:JSON.stringify({matched:true,reason:'测试',items:[{values:{amount:wrongType?'12000':12000,confirmed:false},evidence:{amount:'1.2万元',confirmed:'否'}}]})}; } };
  const collection = new CollectionService(repo(CollectionRecord),repo(Robot),repo(Group),models,{consume:async()=>({allowed:true})},{filter:async text=>({action:'ALLOWED',text})},{resolve:async()=>{identityCalls++;throw Error('Must not resolve an OCR identity');}});
  const service = new CollectorService(db,collection);
  const payloads = new Map([
    ['fixture-admin',{domain:'tenant',sub:accountId,tenantId,role:'TENANT_ADMIN',roleId:'r',windows:['messages','groups'],sessionVersion:0}],
    ['fixture-foreign',{domain:'tenant',sub:otherAccount,tenantId:otherTenant,role:'TENANT_ADMIN',roleId:'r',windows:['messages','groups'],sessionVersion:0}],
    ['fixture-operator',{domain:'tenant',sub:operatorId,tenantId,role:'TENANT_OP',roleId:'r',windows:['messages','groups'],sessionVersion:0}],
    ['fixture-denied',{domain:'tenant',sub:'denied',tenantId,role:'TENANT_OP',roleId:'r',windows:[],sessionVersion:0}],
    ['fixture-platform',{domain:'platform',sub:'platform',role:'SUPER_ADMIN'}]
  ]);
  const auth = {verifyAccessToken:t=>{if(!payloads.has(t))throw new UnauthorizedException();return structuredClone(payloads.get(t));}};
  const roles = {accountAccess:async id=>{const p=[...payloads.values()].find(p=>p.sub===id);return p?{roleId:'r',roleName:'合成',authority:p.role,windows:p.windows,account:{sessionVersion:0,mustChangePassword:false}}:null;}};
  class SyntheticLogin { login(body) { if(body.account!=='synthetic-admin'||body.password!=='synthetic-password')throw new UnauthorizedException();return {access_token:'fixture-admin'}; } }
  Controller('api/v1/platform/auth/tenant')(SyntheticLogin); Post('login')(SyntheticLogin.prototype,'login',Object.getOwnPropertyDescriptor(SyntheticLogin.prototype,'login')); Body()(SyntheticLogin.prototype,'login',0);
  const module = await Test.createTestingModule({controllers:[CollectorController,SyntheticLogin],providers:[{provide:CollectorService,useValue:service}]}).compile();
  const app = module.createNestApplication({logger:false}); app.useGlobalGuards(new ApiAuthGuard(auth,roles)); app.useGlobalInterceptors(new TransformInterceptor());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'collector-tenant-contract-'));
  try {
    await app.listen(0,'127.0.0.1'); const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`, base='/api/v1/tenant/collector';
    const request = async (path, body, token='fixture-admin') => { const r=await fetch(origin+base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.json();return {status:r.status,body:raw.data??raw}; };
    const store = new Store(path.join(directory,'synthetic.enc'),{encode:v=>Buffer.from(v),decode:v=>v.toString()}); await store.load();
    await store.mutate(d=>{d.groups.push({id:'local-a',name:'合成甲群'},{id:'local-b',name:'合成乙群'});});
    const sync = new TenantSync(store); await sync.init(); await sync.login({origin,account:'synthetic-admin',password:'synthetic-password'});
    assert.equal(sync.state().profile.tenantId,tenantId); const deviceId=sync.state().profile.deviceId;
    const bind=async localGroupId=>sync.bind({localGroupId,createNew:true,confirmed:true,enabled:true,layoutConfirmed:true,selfNickname:'测试本人'});
    await bind('local-a'); await bind('local-b'); assert.equal(table(Group).length,2); const binding=sync.state().bindings[0];
    await repo(Group).update({id:binding.groupId},{robotId:robot.id,status:'BOUND'});
    const capture={id:randomUUID(),imageHash:'a'.repeat(64),confidence:99,capturedAt:new Date(Date.now()+20).toISOString()};
    const observation={content:'金额：1.2万元；已确认：否。',senderNickname:'测试本人',isSelf:true,confidence:99,reliable:true};
    await sync.observe(capture,'local-a',[observation]); await sync.flush();
    let row=sync.state().messages[0]; assert.equal(row.state,'synced');assert.equal(row.receipt.processingStatus,'collected');assert.equal(modelCalls,1);assert.equal(identityCalls,0);
    assert.deepEqual(table(CollectionRecord)[0].items[0].values,{amount:12000,confirmed:false});assert.equal(table(CollectionRecord)[0].sourceMetadata.isSelf,true);
    assert.equal(table(CollectorMessage)[0].accountId,accountId); assert.equal(table(CollectorMessage)[0].senderNickname,'测试本人');
    const payload=store.snapshot().syncMessages[0].payload;
    const duplicate=await request(`/devices/${deviceId}/messages`,payload); assert.equal(duplicate.status,201);assert.equal(modelCalls,1);
    assert.equal((await request(`/devices/${deviceId}/messages`,{...payload,content:'不同内容'})).status,409);
    for (const token of ['', 'fixture-denied','fixture-platform','fixture-foreign','fixture-operator']) assert.ok([401,403].includes((await request(`/devices/${deviceId}/messages`,payload,token)).status));
    assert.equal((await request(`/devices/${deviceId}/messages`,{...payload,tenantId:otherTenant})).status,403);
    assert.equal((await request(`/devices/${deviceId}/bindings`,{localGroupId:'local-a',observedName:'合成甲群',groupId:'foreign-group',enabled:true,confirmed:true})).status,409);
    for(const bad of [{isSelf:'true'},{senderNickname:''},{identitySource:'guess'},{evidence:{imageHash:'a'.repeat(64),confidence:90,layoutVersion:1}},{sourceMessageId:'unsafe,id'},{capturedAt:'tomorrow'}])assert.throws(()=>collectorPayload({...payload,...bad}));
    const list=await request('/messages');assert.equal(list.body.total,1);assert.equal(list.body.items[0].isSelf,true);
    assert.equal((await request('/messages',undefined,'fixture-foreign')).body.total,0);
    await sync.observe({...capture,id:randomUUID()},'local-b',[]);await sync.flush();assert.equal(table(CollectorMessage).length,1);
    const pending=sync.state().messages.find(m=>m.state==='pending_review');await sync.review(pending.id,{senderNickname:'示例乙',isSelf:false,content:observation.content,confirmed:true});await sync.flush();
    assert.equal(table(CollectorMessage).length,2);assert.equal(sync.state().messages.find(m=>m.id===pending.id).receipt.processingStatus,'awaiting_robot');assert.equal(modelCalls,1);
    const second=table(CollectorMessage).find(m=>m.sourceMessageId===pending.id);await repo(Group).update({id:second.groupId},{robotId:robot.id,status:'BOUND'});wrongType=true;
    assert.equal((await request(`/messages/${second.id}/process`,{})).body.processingStatus,'failed');assert.equal(table(CollectionRecord)[1].validationErrors[0].code,'FIELD_TYPE');assert.deepEqual(table(CollectionRecord)[1].items,[]);
    assert.equal((await request(`/devices/${deviceId}/revoke`,{},'fixture-operator')).status,404);
    assert.equal((await request(`/devices/${deviceId}/revoke`,{})).status,201);
    assert.equal((await request(`/devices/${deviceId}/messages`,payload)).status,403);
    assert.equal((await request('/devices',{installationId:store.snapshot().installationId,name:'re-register'})).status,403);
    assert.ok(table(CollectorBinding).every(b=>!b.enabled));
    const persisted=await fs.readFile(store.file,'utf8');assert.doesNotMatch(persisted,/synthetic-password|fixture-admin/);
    sync.logout();console.log('PASS: tenant sync real HTTP + guard + service + strict extraction; scoped login/device/group, nickname/self, pending review, idempotence/conflict, tenant/account/role boundaries, revocation and invalid field rejection. Synthetic login/DB/model only.');
  } finally { await app.close(); await fs.rm(directory,{recursive:true,force:true}); }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
