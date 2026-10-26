import { HttpException } from '@nestjs/common';
import { PaymentSettlementService } from './payment-settlement.service';

describe('PaymentSettlementService', () => {
  const order = { id: 'o-1', merchantOrderNo: 'S1', tenantId: 't-1', planId: 'p-2', planName: '专业版', amount: 1888, payType: 'ALIPAY', status: 'PENDING' };
  const orderRepo = { findOne: jest.fn(), save: jest.fn(async (value) => value) };
  const tenantRepo = { findOne: jest.fn(), save: jest.fn(async (value) => value) };
  const manager = { getRepository: jest.fn((entity: { name?: string }) => entity.name === 'PaymentOrder' ? orderRepo : tenantRepo) };
  const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) };
  const audit = { log: jest.fn(async () => undefined) };
  const notifications = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const service = new PaymentSettlementService(dataSource as never, audit as never, notifications as never);

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepo.findOne.mockResolvedValue({ ...order });
    tenantRepo.findOne.mockResolvedValue({ id: 't-1', planId: 'p-1', cycleStartAt: '2026-08-01', aiQuotaUsed: 500 });
  });

  it('验签结果金额匹配后在事务内入账并让套餐生效', async () => {
    const paid = await service.settle('ALIPAY', { merchantOrderNo: 'S1', transactionId: 'TRADE-1', amount: 1888 });
    expect(paid).toMatchObject({ status: 'PAID', gatewayTransactionId: 'TRADE-1' });
    expect(tenantRepo.save).toHaveBeenCalledWith(expect.objectContaining({ planId: 'p-2', aiQuotaUsed: 0 }));
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('回调金额与订单不一致时拒绝入账', async () => {
    await expect(service.settle('ALIPAY', { merchantOrderNo: 'S1', transactionId: 'TRADE-1', amount: 1 })).rejects.toBeInstanceOf(HttpException);
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(tenantRepo.save).not.toHaveBeenCalled();
  });
});
