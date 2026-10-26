import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 套餐支付订单（租户侧切换套餐 → 扫码/对公转账 → 生效） */
@Entity('payment_orders')
export class PaymentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'plan_name' })
  planName: string;

  /** 应付金额（分，差价计算） */
  @Column({ type: 'int' })
  amount: number;
  @Column({ type: 'jsonb', default: () => "'{}'" }) entitlement: { effectType?: 'IMMEDIATE' | 'NEXT_CYCLE'; validityDays?: number; basePlanId?: string; baseCycle?: string; baseEnd?: string; };

  /** WECHAT 微信扫码 / ALIPAY 支付宝扫码 / BANK_TRANSFER 对公转账 */
  @Column({ name: 'pay_type', default: 'WECHAT' })
  payType: 'WECHAT' | 'ALIPAY' | 'BANK_TRANSFER';

  /** PENDING 待支付 / PENDING_VERIFICATION 待核销（对公转账）/ PAID 已支付 / CANCELLED 已取消 / EXPIRED 已过期 */
  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'PENDING_VERIFICATION' | 'PAID' | 'CANCELLED' | 'EXPIRED';

  /** 扫码支付码内容（微信/支付宝网关返回的标准格式）。 */
  @Column({ name: 'qr_content', nullable: true })
  qrContent?: string;

  /** 本平台提交给支付网关的唯一商户订单号。 */
  @Column({ name: 'merchant_order_no', unique: true, nullable: true })
  merchantOrderNo?: string;

  /** 网关支付成功后返回的交易号，用于对账与幂等。 */
  @Column({ name: 'gateway_transaction_id', nullable: true })
  gatewayTransactionId?: string;

  /** 对公转账账户信息（JSON：户名/账号/开户行） */
  @Column({ name: 'bank_info', type: 'jsonb', nullable: true })
  bankInfo?: Record<string, string>;

  /** 对公转账备注（订单号，用户转账时填写） */
  @Column({ nullable: true })
  remark?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt?: Date;
}
