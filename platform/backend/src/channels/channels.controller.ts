import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { AuditService } from '../audit/audit.service';
import { DingTalkService } from './dingtalk.service';
import { FeishuService } from './feishu.service';
import { WeComService } from './wecom.service';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from './channel-secrets';
import { redactLogValue } from '../common/logging/redacting-logger';
import { ensureWebSiteKey, parseWebOrigins } from './web-channel.util';
import { DirectorySyncService } from '../users/directory-sync.service';
import { dingTalkConnectionMode, ensureDingTalkConfig } from './dingtalk-channel.util';

/** 渠道管理（FR-004）：企微/钉钉/飞书/Web 统一接入 */
@Controller('api/v1/tenant/channels')
export class ChannelsController {
  constructor(
    @InjectRepository(Channel) private readonly repo: Repository<Channel>,
    private readonly audit: AuditService,
    private readonly dingtalk: DingTalkService,
    private readonly feishu: FeishuService,
    private readonly wecom: WeComService,
    private readonly secrets: SecretsService,
    private readonly directorySync: DirectorySyncService,
  ) {}

  /** 渠道列表 */
  @Get()
  async list(@Query('tenantId') tenantId: string): Promise<Channel[]> {
    const channels = await this.repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } });
    return Promise.all(channels.map((channel) => this.protectAndRedact(channel)));
  }

  /** 接入新渠道（类型 + 凭据配置） */
  @Post()
  async create(@Body() body: { tenantId: string; type: Channel['type']; name?: string; config?: Record<string, string>; bindRobotId?: string }): Promise<Channel> {
    const rawConfig = body.type === 'web'
      ? ensureWebSiteKey(body.config ?? {})
      : body.type === 'dingtalk'
        ? ensureDingTalkConfig(body.config ?? {})
        : body.config ?? {};
    const channel = await this.repo.save(this.repo.create({
      tenantId: body.tenantId,
      type: body.type,
      name: body.name ?? this.defaultName(body.type),
      config: this.secrets.encryptRecord(rawConfig, channelSecretFields(body.type)),
      status: 'pending',
      bindRobotId: body.bindRobotId,
    }));
    await this.audit.log({
      tenantId: body.tenantId,
      question: `[渠道] 接入 ${channel.name}`,
      result: '渠道接入',
    });
    return this.redact(channel);
  }

  /** 测试连接：实际请求厂商鉴权端点，避免仅检查字段造成假成功。 */
  @Post(':id/test')
  async test(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<{ ok: boolean; message: string }> {
    const channel = await this.findTenantChannel(id, tenantId);
    const config = this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type));
    const required = this.requiredFields(channel.type);
    const missing = required.filter((f) => !config[f]);
    if (missing.length) return { ok: false, message: `缺少配置: ${missing.join(', ')}` };
    try {
      if (channel.type === 'wecom') await this.wecom.testConnection(id, tenantId);
      else if (channel.type === 'dingtalk') await this.dingtalk.testConnection(id, tenantId);
      else if (channel.type === 'feishu') await this.feishu.testConnection(id, tenantId);
      else parseWebOrigins(config.domains ?? '');
      return { ok: true, message: channel.type === 'web' ? '域名白名单有效，可以生成嵌入代码 ✓' : '厂商鉴权成功，连接可达 ✓' };
    } catch (error) {
      return { ok: false, message: String(redactLogValue((error as Error).message)) };
    }
  }

  /** 启用/连接（钉钉/飞书：启动长连接；企微：回调验签即用无需长连） */
  @Post(':id/connect')
  async connect(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Channel> {
    const channel = await this.findTenantChannel(id, tenantId);
    if (channel.type === 'dingtalk') {
      await this.dingtalk.start(channel.id, channel.tenantId);
    } else if (channel.type === 'feishu') {
      await this.feishu.start(channel.id, channel.tenantId);
    } else if (channel.type === 'wecom') {
      await this.wecom.testConnection(channel.id, channel.tenantId);
    } else {
      channel.config = ensureWebSiteKey(channel.config);
      parseWebOrigins(this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type)).domains ?? '');
    }
    channel.status = 'connected';
    channel.isActive = true;
    return this.redact(await this.repo.save(channel));
  }

  /** 停用（钉钉/飞书：断开长连接） */
  @Post(':id/disconnect')
  async disconnect(@Param('id') id: string, @Query('tenantId') tenantId: string): Promise<Channel> {
    const channel = await this.findTenantChannel(id, tenantId);
    if (channel.type === 'dingtalk') {
      await this.dingtalk.stop(channel.id);
    } else if (channel.type === 'feishu') {
      await this.feishu.stop(channel.id);
    }
    channel.status = 'disconnected';
    channel.isActive = false;
    return this.redact(await this.repo.save(channel));
  }

  /** 更新凭据配置（合并覆盖，回调联调/改 key 用） */
  @Patch(':id/config')
  async updateConfig(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { config: Record<string, string> }): Promise<Channel> {
    const channel = await this.findTenantChannel(id, tenantId);
    channel.config = this.secrets.mergeEncryptedRecord(channel.config, body.config, channelSecretFields(channel.type));
    if (channel.type === 'web') channel.config = ensureWebSiteKey(channel.config);
    if (channel.type === 'dingtalk') channel.config = ensureDingTalkConfig(channel.config);
    if (channel.type === 'dingtalk') await this.dingtalk.invalidate(channel.id);
    if (channel.status === 'connected' && channel.type === 'feishu') await this.feishu.stop(channel.id);
    channel.status = 'pending';
    channel.isActive = false;
    return this.redact(await this.repo.save(channel));
  }

  /** 绑定机器人 */
  @Patch(':id/bind')
  async bind(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { robotId?: string }): Promise<Channel> {
    const channel = await this.findTenantChannel(id, tenantId);
    channel.bindRobotId = body.robotId ?? null;
    return this.redact(await this.repo.save(channel));
  }

  /** 从指定企业渠道同步通讯录，避免默认命中其他已连接渠道。 */
  @Post(':id/sync-directory')
  async syncDirectory(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const channel = await this.findTenantChannel(id, tenantId);
    if (channel.status !== 'connected' || !['wecom', 'dingtalk', 'feishu'].includes(channel.type)) {
      throw new HttpException({ code: 42201, message: '仅已连接的企业渠道支持通讯录同步', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const data = await this.directorySync.sync(tenantId, id);
    return { code: 0, message: `通讯录同步完成：新增 ${data.created} 人，更新 ${data.updated} 人`, data };
  }

  /** 删除 */
  @Post(':id/remove')
  async remove(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const channel = await this.findTenantChannel(id, tenantId);
    if (channel.type === 'dingtalk') await this.dingtalk.invalidate(channel.id);
    if (channel.type === 'feishu') await this.feishu.stop(channel.id);
    return this.repo.delete(channel.id);
  }

  private defaultName(type: Channel['type']): string {
    return { wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书', web: 'Web 聊天' }[type];
  }

  private requiredFields(type: Channel['type']): string[] {
    switch (type) {
      case 'wecom': return ['corp_id', 'secret', 'token', 'aes_key'];
      case 'dingtalk': return ['app_key', 'app_secret', 'robot_code'];
      case 'feishu': return ['app_id', 'app_secret'];
      case 'web': return ['domains'];
      default: return [];
    }
  }

  private async findTenantChannel(id: string, tenantId: string): Promise<Channel> {
    if (!tenantId) throw new HttpException({ code: 40001, message: '参数缺失: tenantId', data: null }, HttpStatus.BAD_REQUEST);
    const channel = await this.repo.findOne({ where: { id, tenantId } });
    if (!channel) throw new HttpException({ code: 40401, message: '渠道不存在', data: null }, HttpStatus.NOT_FOUND);
    return channel;
  }

  private async protectAndRedact(channel: Channel): Promise<Channel> {
    const rawConfig = channel.type === 'web'
      ? ensureWebSiteKey(channel.config)
      : channel.type === 'dingtalk'
        ? ensureDingTalkConfig(channel.config)
        : channel.config;
    const protectedConfig = this.secrets.encryptRecord(rawConfig, channelSecretFields(channel.type));
    if (JSON.stringify(protectedConfig) !== JSON.stringify(channel.config)) {
      channel.config = protectedConfig;
      await this.repo.save(channel);
    }
    return this.redact(channel);
  }

  private redact(channel: Channel): Channel {
    return {
      ...channel,
      // 只修正响应，不覆盖数据库中用于启动恢复的启用状态。
      status: channel.type === 'dingtalk' && dingTalkConnectionMode(channel.config) === 'stream'
        && channel.status === 'connected' && !this.dingtalk.isConnected(channel.id)
        ? 'disconnected' : channel.status,
      config: this.secrets.redactRecord(channel.config, channelSecretFields(channel.type)),
    } as Channel;
  }
}
