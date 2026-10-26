import { BadGatewayException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDecipheriv, createSign, createVerify, randomBytes } from 'crypto';

export interface GatewayPaymentResult {
  merchantOrderNo: string;
  transactionId: string;
  amount: number;
}

/** 微信支付 API v3 Native + 支付宝预创建支付；未配置商户密钥时安全失败。 */
@Injectable()
export class PaymentGatewayService {
  constructor(private readonly config: ConfigService) {}

  async createNativeOrder(type: 'WECHAT' | 'ALIPAY', orderNo: string, amount: number, description: string): Promise<string> {
    return type === 'WECHAT'
      ? this.createWechatOrder(orderNo, amount, description)
      : this.createAlipayOrder(orderNo, amount, description);
  }

  verifyWechatCallback(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayPaymentResult {
    const signature = String(headers['wechatpay-signature'] ?? '');
    const timestamp = String(headers['wechatpay-timestamp'] ?? '');
    const nonce = String(headers['wechatpay-nonce'] ?? '');
    const serial = String(headers['wechatpay-serial'] ?? '');
    if (!signature || !/^\d+$/.test(timestamp) || !nonce || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      throw new UnauthorizedException('微信支付回调头无效或已过期');
    }
    const expectedSerial = this.config.get<string>('WECHAT_PAY_PLATFORM_SERIAL');
    if (expectedSerial && serial !== expectedSerial) throw new UnauthorizedException('微信支付平台证书序列号不匹配');
    const publicKey = this.pem('WECHAT_PAY_PLATFORM_PUBLIC_KEY');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`);
    verifier.end();
    if (!verifier.verify(publicKey, signature, 'base64')) throw new UnauthorizedException('微信支付回调验签失败');

    const envelope = JSON.parse(rawBody.toString('utf8')) as {
      event_type?: string;
      resource?: { algorithm?: string; ciphertext?: string; nonce?: string; associated_data?: string };
    };
    if (envelope.event_type !== 'TRANSACTION.SUCCESS' || envelope.resource?.algorithm !== 'AEAD_AES_256_GCM' || !envelope.resource.ciphertext || !envelope.resource.nonce) {
      throw new UnauthorizedException('微信支付回调事件无效');
    }
    const key = Buffer.from(this.required('WECHAT_PAY_API_V3_KEY'), 'utf8');
    if (key.length !== 32) throw new ServiceUnavailableException('WECHAT_PAY_API_V3_KEY 必须为 32 字节');
    const encrypted = Buffer.from(envelope.resource.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.resource.nonce));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    if (envelope.resource.associated_data) decipher.setAAD(Buffer.from(envelope.resource.associated_data));
    const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
    const transaction = JSON.parse(plain.toString('utf8')) as { appid?: string; mchid?: string; out_trade_no?: string; transaction_id?: string; trade_state?: string; amount?: { total?: number } };
    if (transaction.appid !== this.required('WECHAT_PAY_APP_ID') || transaction.mchid !== this.required('WECHAT_PAY_MCH_ID')) {
      throw new UnauthorizedException('微信支付商户或应用不匹配');
    }
    if (transaction.trade_state !== 'SUCCESS' || !transaction.out_trade_no || !transaction.transaction_id || !Number.isInteger(transaction.amount?.total)) {
      throw new UnauthorizedException('微信支付交易数据不完整');
    }
    return { merchantOrderNo: transaction.out_trade_no, transactionId: transaction.transaction_id, amount: transaction.amount!.total! };
  }

  verifyAlipayCallback(body: Record<string, unknown>): GatewayPaymentResult {
    const sign = String(body.sign ?? '');
    const signType = String(body.sign_type ?? 'RSA2');
    if (!sign || signType !== 'RSA2') throw new UnauthorizedException('支付宝回调签名缺失或算法无效');
    const canonical = Object.keys(body)
      .filter((key) => key !== 'sign' && key !== 'sign_type' && body[key] !== undefined && body[key] !== '')
      .sort().map((key) => `${key}=${String(body[key])}`).join('&');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(canonical, 'utf8');
    verifier.end();
    if (!verifier.verify(this.pem('ALIPAY_PUBLIC_KEY'), sign, 'base64')) throw new UnauthorizedException('支付宝回调验签失败');
    if (String(body.app_id ?? '') !== this.required('ALIPAY_APP_ID')) throw new UnauthorizedException('支付宝应用 ID 不匹配');
    const sellerId = this.config.get<string>('ALIPAY_SELLER_ID');
    if (sellerId && String(body.seller_id ?? '') !== sellerId) throw new UnauthorizedException('支付宝收款账号不匹配');
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(String(body.trade_status ?? ''))) throw new UnauthorizedException('支付宝交易尚未成功');
    const amount = Math.round(Number(body.total_amount) * 100);
    const merchantOrderNo = String(body.out_trade_no ?? '');
    const transactionId = String(body.trade_no ?? '');
    if (!merchantOrderNo || !transactionId || !Number.isInteger(amount) || amount < 0) throw new UnauthorizedException('支付宝交易数据不完整');
    return { merchantOrderNo, transactionId, amount };
  }

  private async createWechatOrder(orderNo: string, amount: number, description: string): Promise<string> {
    const endpoint = this.config.get('WECHAT_PAY_NATIVE_URL', 'https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    const body = JSON.stringify({
      appid: this.required('WECHAT_PAY_APP_ID'), mchid: this.required('WECHAT_PAY_MCH_ID'),
      description: description.slice(0, 127), out_trade_no: orderNo,
      notify_url: this.required('WECHAT_PAY_NOTIFY_URL'), amount: { total: amount, currency: 'CNY' },
    });
    const url = new URL(endpoint);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signer = createSign('RSA-SHA256');
    signer.update(`POST\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${body}\n`);
    signer.end();
    const signature = signer.sign(this.pem('WECHAT_PAY_PRIVATE_KEY'), 'base64');
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.required('WECHAT_PAY_MCH_ID')}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.required('WECHAT_PAY_MERCHANT_SERIAL')}"`;
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'saas-ai-robot-platform/1.0' }, body });
    const result = await response.json().catch(() => null) as { code_url?: string; code?: string; message?: string } | null;
    if (!response.ok || !result?.code_url) throw new BadGatewayException({ code: 50201, message: `微信支付下单失败：${result?.message ?? response.status}`, data: null });
    return result.code_url;
  }

  private async createAlipayOrder(orderNo: string, amount: number, description: string): Promise<string> {
    const params: Record<string, string> = {
      app_id: this.required('ALIPAY_APP_ID'), method: 'alipay.trade.precreate', format: 'JSON', charset: 'utf-8', sign_type: 'RSA2',
      timestamp: this.formatDate(new Date()), version: '1.0', notify_url: this.required('ALIPAY_NOTIFY_URL'),
      biz_content: JSON.stringify({ out_trade_no: orderNo, total_amount: (amount / 100).toFixed(2), subject: description.slice(0, 256) }),
    };
    const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    const signer = createSign('RSA-SHA256'); signer.update(canonical, 'utf8'); signer.end();
    params.sign = signer.sign(this.pem('ALIPAY_APP_PRIVATE_KEY'), 'base64');
    const response = await fetch(this.config.get('ALIPAY_GATEWAY_URL', 'https://openapi.alipay.com/gateway.do'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(params),
    });
    const result = await response.json().catch(() => null) as { alipay_trade_precreate_response?: { code?: string; msg?: string; sub_msg?: string; qr_code?: string } } | null;
    const trade = result?.alipay_trade_precreate_response;
    if (!response.ok || trade?.code !== '10000' || !trade.qr_code) throw new BadGatewayException({ code: 50201, message: `支付宝下单失败：${trade?.sub_msg ?? trade?.msg ?? response.status}`, data: null });
    return trade.qr_code;
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new ServiceUnavailableException({ code: 50301, message: `支付网关缺少 ${key} 配置`, data: null });
    return value;
  }

  private pem(key: string): string {
    return this.required(key).replace(/\\n/g, '\n');
  }

  private formatDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}
