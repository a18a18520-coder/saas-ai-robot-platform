import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createSign, generateKeyPairSync } from 'crypto';
import { PaymentGatewayService } from './payment-gateway.service';

describe('PaymentGatewayService', () => {
  it('未配置商户参数时拒绝创建本地假订单', async () => {
    const service = new PaymentGatewayService({ get: jest.fn(() => undefined) } as never);
    await expect(service.createNativeOrder('WECHAT', 'ORDER-1', 100, '测试')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('支付宝回调必须通过 RSA2 验签且应用、金额、交易号完整', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const values: Record<string, string> = {
      ALIPAY_APP_ID: '2026000000000001',
      ALIPAY_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    const service = new PaymentGatewayService({ get: jest.fn((key: string) => values[key]) } as never);
    const body: Record<string, string> = {
      app_id: values.ALIPAY_APP_ID,
      out_trade_no: 'SORDER001',
      trade_no: '202609130001',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '18.88',
      sign_type: 'RSA2',
    };
    const canonical = Object.keys(body).filter((key) => key !== 'sign_type').sort().map((key) => `${key}=${body[key]}`).join('&');
    const signer = createSign('RSA-SHA256');
    signer.update(canonical, 'utf8'); signer.end();
    body.sign = signer.sign(privateKey, 'base64');

    expect(service.verifyAlipayCallback(body)).toEqual({ merchantOrderNo: 'SORDER001', transactionId: '202609130001', amount: 1888 });
    expect(() => service.verifyAlipayCallback({ ...body, total_amount: '0.01' })).toThrow(UnauthorizedException);
  });

  it('微信回调须通过平台签名、AEAD 解密并匹配本商户', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const apiKey = '12345678901234567890123456789012';
    const values: Record<string, string> = {
      WECHAT_PAY_PLATFORM_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      WECHAT_PAY_PLATFORM_SERIAL: 'SERIAL-1', WECHAT_PAY_API_V3_KEY: apiKey,
      WECHAT_PAY_APP_ID: 'wx-app', WECHAT_PAY_MCH_ID: 'mch-1',
    };
    const service = new PaymentGatewayService({ get: jest.fn((key: string) => values[key]) } as never);
    const nonce = '123456789012';
    const associatedData = 'transaction';
    const transaction = JSON.stringify({ appid: 'wx-app', mchid: 'mch-1', out_trade_no: 'SORDER002', transaction_id: 'WX-1', trade_state: 'SUCCESS', amount: { total: 688 } });
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([cipher.update(transaction), cipher.final(), cipher.getAuthTag()]).toString('base64');
    const rawBody = Buffer.from(JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: { algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: associatedData, ciphertext } }));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headerNonce = 'callback-nonce';
    const signer = createSign('RSA-SHA256');
    signer.update(`${timestamp}\n${headerNonce}\n${rawBody.toString('utf8')}\n`); signer.end();
    const headers = { 'wechatpay-signature': signer.sign(privateKey, 'base64'), 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': headerNonce, 'wechatpay-serial': 'SERIAL-1' };

    expect(service.verifyWechatCallback(headers, rawBody)).toEqual({ merchantOrderNo: 'SORDER002', transactionId: 'WX-1', amount: 688 });
    const wrongMerchant = Buffer.from(rawBody.toString());
    expect(() => service.verifyWechatCallback({ ...headers, 'wechatpay-signature': 'invalid' }, wrongMerchant)).toThrow(UnauthorizedException);
  });
});
