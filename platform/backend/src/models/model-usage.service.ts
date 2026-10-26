import { Controller, Get, Injectable, Logger, NotFoundException, Param, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface UsageContext { structuredEvidence?: boolean; robotId?: string; operation: 'answer' | 'rewrite' | 'compression' | 'tool_selection' | 'evaluation' | 'grounding' | 'wiki_graph' | 'rerank' | 'collection'; }
export interface UsageAttempt extends UsageContext { tenantId: string; modelId: string; attempt: number; fallback: boolean; }
export function normalizeUsage(raw: any) {
  const number = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const input = number(raw?.prompt_tokens ?? raw?.input_tokens);
  const output = number(raw?.completion_tokens ?? raw?.output_tokens);
  const total = input !== null && output !== null ? input + output : number(raw?.total_tokens);
  return { input, output, total, incomplete: input === null || output === null };
}

@Injectable()
export class ModelUsageService {
  private readonly logger = new Logger(ModelUsageService.name);
  constructor(private readonly db: DataSource) {}
  async record(context: UsageAttempt, startedAt: Date, success: boolean, usage: unknown) {
    const u = normalizeUsage(usage);
    try {
      await this.db.query(`INSERT INTO robot_model_usage ("tenantId","robotId","modelId",operation,attempt,fallback,"startedAt",success,"inputTokens","outputTokens","totalTokens",incomplete) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [context.tenantId, context.robotId, context.modelId, context.operation, context.attempt, context.fallback, startedAt, success, u.input, u.output, u.total, u.incomplete]);
    } catch { // A telemetry failure must never repeat a potentially billable model request.
      this.logger.error('Token usage persistence failed; model request will not be retried for this error');
    }
  }
  async stats(tenantId: string, robotId: string) {
    const robots = await this.db.query('SELECT id FROM robots WHERE id=$1 AND tenant_id=$2', [robotId, tenantId]);
    if (!robots.length) throw new NotFoundException('机器人不存在');
    const aggregate = `COUNT(*)::int AS calls, COALESCE(SUM("inputTokens"),0)::float8 AS input, COALESCE(SUM("outputTokens"),0)::float8 AS output, COALESCE(SUM("totalTokens"),0)::float8 AS total, COUNT(*) FILTER (WHERE incomplete)::int AS incomplete, COUNT(*) FILTER (WHERE NOT success)::int AS failed, COUNT(*) FILTER (WHERE fallback)::int AS fallback, COUNT(*) FILTER (WHERE attempt > 1 AND NOT fallback)::int AS retries`;
    const [totals] = await this.db.query(`SELECT ${aggregate} FROM robot_model_usage WHERE "tenantId"=$1 AND "robotId"=$2`, [tenantId, robotId]);
    const monthly = await this.db.query(`SELECT to_char("startedAt" AT TIME ZONE 'Asia/Shanghai','YYYY-MM') AS month, ${aggregate} FROM robot_model_usage WHERE "tenantId"=$1 AND "robotId"=$2 GROUP BY month ORDER BY month DESC`, [tenantId, robotId]);
    const operations = await this.db.query(`SELECT operation, ${aggregate} FROM robot_model_usage WHERE "tenantId"=$1 AND "robotId"=$2 GROUP BY operation ORDER BY operation`, [tenantId, robotId]);
    return { timezone: 'Asia/Shanghai', totals, monthly, operations };
  }
}

@Controller('api/v1/tenant/robots')
export class RobotUsageController {
  constructor(private readonly usage: ModelUsageService) {}
  @Get(':id/token-usage') stats(@Query('tenantId') tenantId: string, @Param('id') id: string) { return this.usage.stats(tenantId, id); }
}
