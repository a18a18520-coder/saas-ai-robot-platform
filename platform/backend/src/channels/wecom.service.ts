import { Injectable, Logger } from '@nestjs/common';
import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from './channel-secrets';

/**
 * 企业微信官方接口服务（真实对接）：
 *  - 回调验签：SHA1(token, timestamp, nonce, encrypt)
 *  - 消息解密：AES-256-CBC（key=AESKey base64，iv=key前16字节，PKCS7）
 *  - 回复加密：同算法反向
 *  - 消息发送：gettoken → appchat/send（真实 API）
 */
@Injectable()
export class WeComService {
  private readonly logger = new Logger(WeComService.name);
  private tokenCache: Record<string, { token: string; expiresAt: number }> = {};

  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    private readonly secrets: SecretsService,
  ) {}

  /** 获取企微渠道配置（按渠道 ID 精确定位，支持同类型多渠道；凭据来自渠道接入管理，不造数据） */
  private async getConfig(channelId: string, tenantId: string): Promise<{ corpId: string; secret: string; token: string; aesKey: string }> {
    const channel = await this.channels.findOne({ where: { id: channelId, type: 'wecom', tenantId } });
    if (!channel) throw new Error('42201: 企业微信渠道未接入或未启用（渠道接入页配置）');
    const c = this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type));
    const missing = ['corp_id', 'secret', 'token', 'aes_key'].filter((f) => !c[f]);
    if (missing.length) throw new Error(`42201: 企微渠道缺少配置: ${missing.join(', ')}`);
    return { corpId: c.corp_id!, secret: c.secret!, token: c.token!, aesKey: c.aes_key! };
  }

  /** 回调验签：sha1(sort(token, timestamp, nonce, encrypt)) */
  verifySignature(signature: string, token: string, timestamp: string, nonce: string, encrypt: string): boolean {
    const arr = [token, timestamp, nonce, encrypt].sort();
    const hash = createHash('sha1').update(arr.join('')).digest('hex');
    return hash === signature;
  }

  /** AES-256-CBC 解密（企微官方算法） */
  decryptMsg(aesKey: string, encrypt: string): string {
    const key = Buffer.from(aesKey + '=', 'base64');
    const iv = key.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
    // PKCS7 去填充
    const padLen = decrypted[decrypted.length - 1];
    const content = decrypted.subarray(0, decrypted.length - padLen);
    // 前 16 字节 random，随后 4 字节 msg_len，之后 msg
    const msgLen = content.readUInt32BE(16);
    return content.subarray(20, 20 + msgLen).toString('utf8');
  }

  /** 回复加密（echo 验证/回复消息） */
  encryptReply(aesKey: string, reply: string): string {
    const key = Buffer.from(aesKey + '=', 'base64');
    const iv = key.subarray(0, 16);
    const random = randomBytes(16);
    const msgLen = Buffer.alloc(4);
    msgLen.writeUInt32BE(Buffer.byteLength(reply));
    const raw = Buffer.concat([random, msgLen, Buffer.from(reply)]);
    // PKCS7 填充到 32 倍数
    const pad = 32 - (raw.length % 32);
    const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
  }

  /** 获取企业 access_token（缓存 110 分钟，按渠道 ID 隔离） */
  async getAccessToken(channelId: string, tenantId: string): Promise<string> {
    const { corpId, secret } = await this.getConfig(channelId, tenantId);
    const cached = this.tokenCache?.[channelId];
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    let json: { errcode: number; errmsg: string; access_token?: string };
    try {
      const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
      json = (await res.json()) as typeof json;
    } catch (e) {
      const cause = (e as { cause?: { message?: string } }).cause;
      throw new Error(`企微 gettoken 网络失败: ${cause?.message ?? (e as Error).message}`);
    }
    if (json.errcode !== 0) throw new Error(`企微 gettoken 失败: ${json.errcode} ${json.errmsg}`);
    this.tokenCache = { ...this.tokenCache, [channelId]: { token: json.access_token!, expiresAt: Date.now() + 110 * 60 * 1000 } };
    return json.access_token!;
  }

  /** 实际请求企微 token 接口验证 CorpID/Secret，不以字段非空代替连通性。 */
  async testConnection(channelId: string, tenantId: string): Promise<void> {
    await this.getAccessToken(channelId, tenantId);
  }

  /** 发送应用消息到群聊（真实 API：appchat/send，按渠道 ID 路由凭据） */
  async sendToGroup(channelId: string, tenantId: string, chatId: string, content: string, images?: string[]): Promise<boolean> {
    const token = await this.getAccessToken(channelId, tenantId);
    const body: Record<string, unknown> = { chatid: chatId, msgtype: images?.length ? 'image' : 'text' };
    if (body.msgtype === 'text') {
      body.text = { content };
    } else {
      // 图片消息需先上传 media（本版以文本+图片说明，企微图片上传待媒体素材）
      body.text = { content: content + (images?.length ? `\n[图片 ${images.length} 张]` : '') };
    }
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { errcode: number; errmsg: string };
    if (json.errcode !== 0) {
      this.logger.warn(`企微发送失败 ${chatId}: ${json.errcode} ${json.errmsg}`);
      return false;
    }
    return true;
  }
}
