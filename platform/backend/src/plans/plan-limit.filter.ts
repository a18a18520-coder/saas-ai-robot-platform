import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
@Catch(QueryFailedError)
export class PlanLimitFilter implements ExceptionFilter {
  catch(error: QueryFailedError, host: ArgumentsHost) {
    const message = error.driverError?.message ?? '';
    const limited = message.startsWith('套餐限制：');
    host.switchToHttp().getResponse().status(limited ? 409 : 500).json({ statusCode: limited ? 409 : 500, message: limited ? message : '数据操作失败，请稍后重试' });
  }
}
