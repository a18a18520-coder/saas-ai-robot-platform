import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Plan } from '../plans/plan.entity';
import { Tenant } from '../tenants/tenant.entity';
import {
  PlatformAccount,
  PlatformRole,
} from '../platform-identity/platform-identity.entity';
import { PlatformIdentityService } from '../platform-identity/platform-identity.service';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * 平台初始数据 seed（部署初始化执行）：
 *  - 三档套餐（FR-020：价格/配额/文件大小档位 20-50-100MB）
 *  - 平台内置超级管理员（FR-030：独立系统首个账号）
 * 用法: npm run seed
 */
const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'robot',
  password: process.env.DB_PASS ?? 'robot',
  database: process.env.DB_NAME ?? 'robot_platform',
  entities: [Plan, Tenant, PlatformRole, PlatformAccount],
  synchronize: false,
});

async function seed() {
  await ds.initialize();
  const planRepo = ds.getRepository(Plan);

  const plans: Array<Partial<Plan>> = [
    {
      name: '标准版',
      price: 999,
      robotLimit: 5,
      userLimit: 200,
      kbLimit: 5,
      aiQuota: 3000,
      fileSizeLimitMb: 20,
      channelLimit: 2,
      adminWindowLimit: 1,
    },
    {
      name: '专业版',
      price: 1999,
      robotLimit: 10,
      userLimit: 500,
      kbLimit: 10,
      aiQuota: 10000,
      fileSizeLimitMb: 50,
      channelLimit: 3,
      adminWindowLimit: 5,
      isFeatured: true,
    },
    {
      name: '旗舰版',
      price: 3999,
      robotLimit: 0,
      userLimit: 0,
      kbLimit: 0,
      aiQuota: 50000,
      fileSizeLimitMb: 100,
      channelLimit: 0,
      adminWindowLimit: 0,
    },
  ];
  for (const p of plans) {
    const exists = await planRepo.findOne({ where: { name: p.name } });
    if (!exists) await planRepo.save(planRepo.create(p));
  }

  const identities = new PlatformIdentityService(
    ds.getRepository(PlatformAccount),
    ds.getRepository(PlatformRole),
    new ConfigService(process.env),
  );
  const admin = await identities.ensureBuiltins();

  console.log('✅ Seed 完成: 三档套餐就绪');
  console.log(`✅ 平台内置超管就绪: ${admin.account}`);
  await ds.destroy();
}

seed().catch((e) => {
  console.error('❌ Seed 失败:', e.message);
  process.exit(1);
});
