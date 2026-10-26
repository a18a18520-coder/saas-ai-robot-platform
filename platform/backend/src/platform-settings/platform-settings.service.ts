import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';
import { PlatformSetting } from './platform-setting.entity';

const SECRET_FIELDS = ['difyApiKey', 'serviceAccountKey'] as const;

@Injectable()
export class PlatformSettingsService {
  constructor(
    @InjectRepository(PlatformSetting) private readonly repo: Repository<PlatformSetting>,
    private readonly secrets: SecretsService,
  ) {}

  async getSafe(): Promise<PlatformSetting> {
    return this.redact(await this.loadAndProtect());
  }

  async save(data: Partial<PlatformSetting>): Promise<PlatformSetting> {
    const setting = await this.loadAndProtect();
    const allowed = ['difyUrl', 'difyApiKey', 'serviceAccountKey', 'newTenantTrialDays', 'quotaThreshold', 'auditRetentionDays', 'sessionRetentionDays'] as const;
    for (const key of allowed) {
      const value = data[key];
      if (value === undefined) continue;
      if (SECRET_FIELDS.includes(key as (typeof SECRET_FIELDS)[number])) {
        if (value !== MASKED_SECRET) (setting as unknown as Record<string, unknown>)[key] = this.secrets.encrypt(String(value));
      } else {
        (setting as unknown as Record<string, unknown>)[key] = value;
      }
    }
    setting.updatedAt = new Date();
    return this.redact(await this.repo.save(setting));
  }

  async adminApiKey(): Promise<string | undefined> {
    return this.secrets.decrypt((await this.loadAndProtect()).difyApiKey);
  }

  async serviceAccountKey(): Promise<string | undefined> {
    return this.secrets.decrypt((await this.loadAndProtect()).serviceAccountKey);
  }

  async difyUrl(): Promise<string | undefined> {
    return (await this.loadAndProtect()).difyUrl;
  }

  private async loadAndProtect(): Promise<PlatformSetting> {
    let setting = (await this.repo.find({ order: { updatedAt: 'DESC' }, take: 1 }))[0];
    if (!setting) setting = await this.repo.save(this.repo.create({}));
    let changed = false;
    for (const key of SECRET_FIELDS) {
      const value = setting[key];
      if (value && !this.secrets.isEncrypted(value)) {
        setting[key] = this.secrets.encrypt(value);
        changed = true;
      }
    }
    return changed ? this.repo.save(setting) : setting;
  }

  private redact(setting: PlatformSetting): PlatformSetting {
    return {
      ...setting,
      difyApiKey: setting.difyApiKey ? MASKED_SECRET : undefined,
      serviceAccountKey: setting.serviceAccountKey ? MASKED_SECRET : undefined,
    } as PlatformSetting;
  }
}
