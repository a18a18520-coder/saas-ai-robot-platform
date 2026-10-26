import { ModelsService } from './models.service';
import { AnswerService } from '../ai-router/answer.service';
describe('tenant model policy', () => {
  it('overrides every robot model including stale published choices', async () => {
    const tenantPolicy = jest.fn(async () => ({ primaryModelId: 'tenant-primary', fallbackModelId: '', rerankModelId: '' }));
    const service = new AnswerService({ tenantPolicy } as any, {} as any, {} as any, {} as any);
    for (const id of ['existing', 'new']) {
      const robot: any = { id, tenantId: 't', ragConfig: { primaryModelId: 'old', fallbackModelId: 'old-backup', systemPrompt: 'keep' } };
      await service.applyTenantModels(robot);
      expect(robot.ragConfig).toEqual({ primaryModelId: 'tenant-primary', fallbackModelId: '', rerankModelId: '', systemPrompt: 'keep' });
    }
  });
  it('rejects unauthorized models before persisting a tenant policy', async () => {
    const query = jest.fn(async () => [{ id: 't' }]);
    const service = new ModelsService({ manager: { query }, findOne: async () => ({ tenantIds: ['other'], purpose: 'chat' }) } as any, {} as any, {} as any);
    await expect(service.saveTenantPolicy('t', { primaryModelId: 'foreign' })).rejects.toThrow('未授权');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
