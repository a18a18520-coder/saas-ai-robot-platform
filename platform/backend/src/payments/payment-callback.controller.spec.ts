import { PaymentCallbackController } from './payment-callback.controller';

describe('PaymentCallbackController', () => {
  const gateway = { verifyWechatCallback: jest.fn(), verifyAlipayCallback: jest.fn() };
  const settlement = { settle: jest.fn(async () => undefined) };
  const controller = new PaymentCallbackController(gateway as never, settlement as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not settle a WeChat callback without the raw signed body', async () => {
    await expect(controller.wechat({}, {} as never)).resolves.toEqual({ code: 'FAIL', message: 'missing raw body' });
    expect(gateway.verifyWechatCallback).not.toHaveBeenCalled();
    expect(settlement.settle).not.toHaveBeenCalled();
  });

  it('settles only the payment returned by WeChat signature verification', async () => {
    const payment = { merchantOrderNo: 'ORDER-1', amount: 9900, transactionId: 'WX-1' };
    gateway.verifyWechatCallback.mockReturnValue(payment);
    const rawBody = Buffer.from('{"signed":true}');
    await expect(controller.wechat({ 'wechatpay-signature': 'signature' }, { rawBody } as never)).resolves.toMatchObject({ code: 'SUCCESS' });
    expect(settlement.settle).toHaveBeenCalledWith('WECHAT', payment);
  });

  it('verifies and settles Alipay before acknowledging success', async () => {
    const payment = { merchantOrderNo: 'ORDER-2', amount: 8800, transactionId: 'ALI-1' };
    gateway.verifyAlipayCallback.mockReturnValue(payment);
    const send = jest.fn((value) => value);
    const response = { type: jest.fn(() => ({ send })) };
    await controller.alipay({ sign: 'signature' }, response as never);
    expect(settlement.settle).toHaveBeenCalledWith('ALIPAY', payment);
    expect(send).toHaveBeenCalledWith('success');
  });
});
