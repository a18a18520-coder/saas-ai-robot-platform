'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
async function main() {
  if (!process.argv[2] || !/^\d+$/.test(process.argv[3] || '')) throw Error('Pass platform repo and ephemeral PostgreSQL port; never use production');
  const backend=path.resolve(process.argv[2],'backend'), pr=createRequire(path.join(backend,'package.json'));
  pr('ts-node').register({project:path.join(backend,'tsconfig.json'),transpileOnly:true});
  const {DataSource}=pr('typeorm'), load=f=>require(path.join(backend,'src',f));
  const {CollectorDevice,CollectorBinding,CollectorMessage}=load('collector/collector.entity.ts');
  const {CollectionRecord}=load('robots/collection-record.entity.ts');
  const migrations=['1790000000021-CollectionRecords','1790000000022-CollectionValidation','1790000000023-CollectionValidationV3','1790000000024-CollectorSync'].map(name=>Object.values(load(`database/migrations/${name}.ts`))[0]);
  const db=new DataSource({type:'postgres',host:'127.0.0.1',port:Number(process.argv[3]),username:'postgres',password:'collector-synthetic-only',database:'collector_synthetic',entities:[CollectorDevice,CollectorBinding,CollectorMessage,CollectionRecord],migrations,synchronize:false});
  await db.initialize();
  try {
    const result=await db.runMigrations({transaction:'all'});assert.equal(result.length,4);
    const tenantId=randomUUID(),accountId=randomUUID(),deviceRepo=db.getRepository(CollectorDevice);
    const device=await deviceRepo.save(deviceRepo.create({tenantId,accountId,installationId:'synthetic-installation',name:'合成测试设备'}));
    assert.equal(device.status,'ACTIVE');
    await assert.rejects(deviceRepo.save(deviceRepo.create({tenantId,accountId,installationId:device.installationId,name:'duplicate'})),e=>e.code==='23505');
    const binding=await db.getRepository(CollectorBinding).save({tenantId,deviceId:device.id,localGroupId:'synthetic-local',groupId:randomUUID(),observedName:'合成群',enabled:true});
    const data={tenantId,accountId,deviceId:device.id,bindingId:binding.id,groupId:binding.groupId,sourceMessageId:'synthetic:1',payloadHash:'a'.repeat(64),senderNickname:'测试本人',isSelf:true,identitySource:'manual_review',content:'合成测试正文',evidence:{identityVerified:false},capturedAt:new Date(),sentAtRaw:null};
    const saved=await db.getRepository(CollectorMessage).save(data);const read=await db.getRepository(CollectorMessage).findOneByOrFail({id:saved.id});
    assert.equal(read.isSelf,true);assert.equal(read.processingStatus,'received');assert.equal(read.senderNickname,'测试本人');
    await assert.rejects(db.getRepository(CollectorMessage).save({...data,id:randomUUID()}),e=>e.code==='23505');
    await assert.rejects(db.transaction(async m=>{await m.update(CollectorDevice,{id:device.id},{status:'REVOKED'});throw Error('rollback fixture');}),/rollback fixture/);
    assert.equal((await deviceRepo.findOneByOrFail({id:device.id})).status,'ACTIVE');
    await db.transaction(async m=>{const d=await m.findOne(CollectorDevice,{where:{id:device.id,tenantId,accountId},lock:{mode:'pessimistic_write'}});d.status='REVOKED';await m.save(d);await m.update(CollectorBinding,{deviceId:device.id},{enabled:false});});
    assert.equal((await deviceRepo.findOneByOrFail({id:device.id})).status,'REVOKED');assert.equal((await db.getRepository(CollectorBinding).findOneByOrFail({id:binding.id})).enabled,false);
    await db.undoLastMigration({transaction:'all'});assert.equal((await db.query("SELECT to_regclass('collector_messages') AS name"))[0].name,null);
    await db.runMigrations({transaction:'all'});assert.equal(await db.getRepository(CollectorDevice).count(),0);
    console.log('PASS: isolated PostgreSQL migration up/down/up, actual TypeORM entity writes, nickname/self fields, unique device/message constraints, rollback and locked device revocation. No production database accessed.');
  } finally {await db.destroy();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
