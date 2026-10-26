import { IsBoolean, IsOptional } from 'class-validator';

/** 生命周期正反向验证（BR-011）——所有禁用/删除操作必带 */
export class LifecycleVerifyDto {
  /** 正向验证：操作生效性确认 */
  @IsBoolean()
  positive: boolean;

  /** 反向验证：副作用正确性确认 */
  @IsBoolean()
  negative: boolean;

  /** 验证结果写入审计 */
  @IsOptional()
  @IsBoolean()
  audit?: boolean = true;
}
