import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { ModelsService, estimateTokens } from '../models/models.service';

export const METRICS = ['faithfulness', 'factual_correctness', 'context_precision', 'context_recall'] as const;
export type RagasResult = { engine: string; version: string; scores: Record<string, number | null>; errors: Record<string, string> };

@Injectable()
export class RagasService {
  constructor(private readonly models: ModelsService) {}
  private paths() {
    const root = existsSync(resolve(process.cwd(), 'ops/ragas/evaluate.py')) ? process.cwd() : resolve(process.cwd(), '..');
    return { python: process.env.RAGAS_PYTHON || resolve(root, '.runtime/ragas-py311/bin/python'), script: resolve(root, 'ops/ragas/evaluate.py') };
  }
  async status() {
    const { python, script } = this.paths();
    if (!existsSync(python) || !existsSync(script)) return { available: false, engine: 'ragas', message: '平台尚未安装 Ragas 运行环境' };
    return new Promise(resolveStatus => {
      const child = spawn(python, [script, '--check'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      const timer = setTimeout(() => child.kill(), 15000);
      child.stdout.on('data', chunk => { output += chunk; });
      child.on('error', () => { clearTimeout(timer); resolveStatus({ available: false, message: 'Ragas 环境启动失败' }); });
      child.on('close', code => { clearTimeout(timer); try { resolveStatus({ ...JSON.parse(output), available: code === 0 }); } catch { resolveStatus({ available: false, message: 'Ragas 环境检查失败' }); } });
    });
  }
  async evaluate(tenantId: string, robotId: string, policy: { primaryModelId: string; fallbackModelId?: string }, sample: { user_input: string; response: string; reference: string; retrieved_contexts: string[] }, progress: (metric: string) => Promise<void>): Promise<RagasResult> {
    const { python, script } = this.paths();
    return new Promise((resolveResult, reject) => {
      const child = spawn(python, [script], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, RAGAS_DO_NOT_TRACK: 'true' } });
      let done = false;
      const finish = (error?: Error, result?: RagasResult) => { if (done) return; done = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolveResult(result!); };
      const timer = setTimeout(() => finish(new Error('Ragas 评测超时，请缩小用例范围后重试')), 600000);
      child.on('error', () => finish(new Error('Ragas 环境不可用，请联系平台管理员')));
      child.on('close', () => { if (!done) finish(new Error('Ragas 进程中断，请重试')); });
      child.stdin.on('error', () => { /* process exit is handled above */ });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', async line => {
        if (done) return;
        try {
          const event = JSON.parse(line);
          if (event.type === 'result') {
            if (!event.scores || !METRICS.every(key => event.scores[key] === null || (typeof event.scores[key] === 'number' && event.scores[key] >= 0 && event.scores[key] <= 1))) { finish(new Error('Ragas 指标格式错误')); return; }
            finish(undefined, event);
          } else if (event.type === 'progress') await progress(event.metric);
          else if (event.type === 'generate') {
            const result = await this.models.generate(tenantId, policy.primaryModelId, policy.fallbackModelId, async model => {
              if (estimateTokens(event.prompt) > model.contextWindow - model.maxOutputTokens - 512) throw new Error('评测证据超过模型上下文，请缩小用例范围');
              return [{ role: 'user', content: event.prompt }];
            }, { robotId, operation: 'evaluation', structuredEvidence: true });
            if (!done) child.stdin.write(JSON.stringify({ text: result.text }) + '\n');
          }
        } catch { if (!done) child.stdin.write(JSON.stringify({ error: '平台评测模型调用失败或上下文超限' }) + '\n'); }
      });
      child.stdin.write(JSON.stringify(sample) + '\n');
    });
  }
}
