import { Body, Controller, Headers, Post, RawBodyRequest, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentSettlementService } from './payment-settlement.service';

/** 支付网关公开回调入口；只接受厂商签名通过且金额匹配的通知。 */
@Controller('api/v1/public/payments')
export class PaymentCallbackController {
  constructor(private readonly gateway: PaymentGatewayService, private readonly settlement: PaymentSettlementService) {}

  @Post('wechat/notify')
  async wechat(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = req.rawBody;
    if (!raw) return { code: 'FAIL', message: 'missing raw body' };
    const payment = this.gateway.verifyWechatCallback(headers, raw);
    await this.settlement.settle('WECHAT', payment);
    return { code: 'SUCCESS', message: '成功' };
  }

  @Post('alipay/notify')
  async alipay(@Body() body: Record<string, unknown>, @Res() response: Response) {
    const payment = this.gateway.verifyAlipayCallback(body);
    await this.settlement.settle('ALIPAY', payment);
    return response.type('text/plain').send('success');
  }
}
