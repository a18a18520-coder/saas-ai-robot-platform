// Local database integration; every fixture is rolled back, no payment or external API calls.
require('dotenv/config');
const { Client } = require('pg');
const { randomUUID } = require('crypto');
const assert = require('node:assert/strict');
const c = new Client({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||5432),user:process.env.DB_USER||'robot',password:process.env.DB_PASS||'robot',database:process.env.DB_NAME||'robot_platform'});
(async () => {
  await c.connect(); await c.query('BEGIN');
  try {
    const p=randomUUID(), t=randomUUID();
    await c.query('INSERT INTO plans(id,name,price,robot_limit,user_limit,kb_limit,channel_limit,admin_window_limit,storage_limit_mb) VALUES($1,$2,0,1,1,1,1,1,1)',[p,'test-'+p]);
    await c.query("INSERT INTO tenants(id,name,plan_id,cycle_start_at,subscription_end,admin_email) VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+30,'test@example.invalid')",[t,'test-'+t,p]);
    async function rejected(sql,args,phrase) {
      await c.query('SAVEPOINT rejection'); let error;
      try {await c.query(sql,args);} catch(e){error=e;}
      await c.query('ROLLBACK TO SAVEPOINT rejection'); assert.ok(error?.message.includes(phrase), error?.message||'Unexpected success');
    }
    for (const sql of ["INSERT INTO robots(tenant_id,name) VALUES($1,'test')", "INSERT INTO users(tenant_id) VALUES($1)", "INSERT INTO channels(tenant_id,name,type,config) VALUES($1,'test','web','{}')"]) {
      await c.query(sql,[t]); await rejected(sql,[t],'上限');
    }
    await c.query("UPDATE robots SET status='DELETED' WHERE tenant_id=$1",[t]);
    await c.query("INSERT INTO robots(tenant_id,name) VALUES($1,'replacement')",[t]);
    const dataset=randomUUID();
    await c.query("INSERT INTO knowledge_bases(tenant_id,dataset_id,name) VALUES($1,$2,'test')",[t,dataset]);
    await rejected("INSERT INTO knowledge_bases(tenant_id,dataset_id,name) VALUES($1,$2,'test')",[t,randomUUID()],'上限');
    const source=randomUUID();
    await c.query("INSERT INTO tenant_accounts(tenant_id,name,account,password_hash,status) VALUES($1,'admin',$2,'test-only','ACTIVE')",[t,randomUUID()+'@example.invalid']);
    await c.query("INSERT INTO tenant_accounts(tenant_id,name,account,password_hash,status) VALUES($1,'extra',$2,'test-only','ACTIVE')",[t,randomUUID()+'@example.invalid']);
    const first=randomUUID(), second=randomUUID();
    await c.query("INSERT INTO groups(id,tenant_id,chat_id,status) VALUES($1::uuid,$2,$1::text,'BOUND')",[first,t]);
    await c.query("INSERT INTO groups(id,tenant_id,chat_id,status) VALUES($1::uuid,$2,$1::text,'PENDING')",[second,t]);
    await rejected("UPDATE groups SET status='BOUND' WHERE id=$1",[second],'上限');
    await c.query("UPDATE groups SET status='DISABLED' WHERE id=$1",[first]);
    await c.query("UPDATE groups SET status='BOUND' WHERE id=$1",[second]);
    await rejected("UPDATE groups SET status='BOUND' WHERE id=$1",[first],'上限');
    await c.query('UPDATE plans SET admin_window_limit=0 WHERE id=$1',[p]);
    await c.query("UPDATE groups SET status='BOUND' WHERE id=$1",[first]);
    await c.query("INSERT INTO ingestion_jobs(tenant_id,dataset_id,source_id,source_version,name,file_path,size) VALUES($1,$2,$3,'v1','test','/tmp/not-created',700000)",[t,dataset,source]);
    await c.query("INSERT INTO knowledge_files(tenant_id,dataset_id,source_id,source_version,name,size) VALUES($1,$2,$3,'v1','test',700000)",[t,dataset,source]);
    await rejected("INSERT INTO ingestion_jobs(tenant_id,dataset_id,source_id,source_version,name,file_path,size) VALUES($1,$2,$3,'v2','test','/tmp/not-created',400000)",[t,dataset,source],'容量');
    await c.query('UPDATE tenants SET subscription_end=CURRENT_DATE WHERE id=$1',[t]);
    await c.query('UPDATE plans SET robot_limit=0 WHERE id=$1',[p]);
    await rejected("INSERT INTO robots(tenant_id,name) VALUES($1,'expired')",[t],'到期');
    console.log('PASS: resource limits, deletion releases a slot, storage reservations avoid double counting, expiry blocks creation.');
  } finally { await c.query('ROLLBACK'); await c.end(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
