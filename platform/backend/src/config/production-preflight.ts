import 'dotenv/config';
import dataSource from '../database/data-source';
import { validateEnvironment } from './environment';

async function preflight(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') throw new Error('NODE_ENV 必须显式设为 production');
  validateEnvironment(process.env);
  for (const key of ['PUBLIC_APP_URL', 'WECHAT_PAY_NOTIFY_URL', 'ALIPAY_NOTIFY_URL']) {
    const value = process.env[key];
    if (value && !value.startsWith('https://')) throw new Error(`${key} 生产环境必须使用 HTTPS`);
  }

  await dataSource.initialize();
  try {
    await dataSource.query('SELECT 1');
    if (await dataSource.showMigrations()) throw new Error('存在未执行的数据库迁移');
  } finally {
    await dataSource.destroy();
  }
  process.stdout.write('上线前检查通过：环境配置、HTTPS 地址、数据库连通性和迁移状态正常\n');
}

preflight().catch((error) => {
  process.stderr.write(`上线前检查失败：${(error as Error).message}\n`);
  process.exitCode = 1;
});
