import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import dataSource from '../database/data-source';
import { Channel } from '../channels/channel.entity';
import { channelSecretFields } from '../channels/channel-secrets';
import { TenantDifyResource } from '../dify/tenant-dify-resource.entity';
import { PlatformSetting } from '../platform-settings/platform-setting.entity';
import { Tool } from '../platform-tools/tool.entity';
import { SecretsService } from './secrets.service';

async function rotate(): Promise<void> {
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error('缺少新 APP_ENCRYPTION_KEY');
  if (!process.env.APP_ENCRYPTION_KEY_PREVIOUS) throw new Error('轮换期间必须配置 APP_ENCRYPTION_KEY_PREVIOUS');
  const secrets = new SecretsService(new ConfigService(process.env));
  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      const tools = await manager.find(Tool);
      for (const row of tools) if (row.apiKey) row.apiKey = secrets.rotate(row.apiKey);
      await manager.save(Tool, tools);

      const channels = await manager.find(Channel);
      for (const row of channels) {
        const config = { ...row.config };
        for (const field of channelSecretFields(row.type)) if (config[field]) config[field] = secrets.rotate(config[field])!;
        row.config = config;
      }
      await manager.save(Channel, channels);

      const resources = await manager.find(TenantDifyResource);
      for (const row of resources) if (row.dsKey) row.dsKey = secrets.rotate(row.dsKey);
      await manager.save(TenantDifyResource, resources);

      const settings = await manager.find(PlatformSetting);
      for (const row of settings) {
        if (row.difyApiKey) row.difyApiKey = secrets.rotate(row.difyApiKey);
        if (row.serviceAccountKey) row.serviceAccountKey = secrets.rotate(row.serviceAccountKey);
      }
      await manager.save(PlatformSetting, settings);
    });
    process.stdout.write('密钥轮换完成：所有受管凭据已使用当前 APP_ENCRYPTION_KEY 重新加密\n');
  } finally {
    await dataSource.destroy();
  }
}

rotate().catch((error) => {
  process.stderr.write(`密钥轮换失败：${(error as Error).message}\n`);
  process.exitCode = 1;
});
