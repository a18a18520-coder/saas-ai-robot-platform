import { TenantKnowledgeController } from './tenant-knowledge.controller';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('TenantKnowledgeController tenant boundary', () => {
  const dify = { listDatasets: jest.fn(), getDocumentStatus: jest.fn(), getDocumentSegments: jest.fn(), deleteDocument: jest.fn() };
  const audit = { log: jest.fn(async () => undefined) };
  const files = { findOne: jest.fn(), find: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const kbs = { find: jest.fn(), findOne: jest.fn() };
  const jobs = { findOne: jest.fn() };
  const controller = new TenantKnowledgeController(dify as never, audit as never, {} as never, files as never, kbs as never, jobs as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists only locally assigned knowledge bases instead of the global Dify pool', async () => {
    kbs.find.mockResolvedValue([{ datasetId: 'dataset-a', name: 'Tenant A KB', visibility: 'all' }]);
    await expect(controller.list('tenant-a')).resolves.toEqual([{ id: 'dataset-a', name: 'Tenant A KB', visibility: 'all', files: [] }]);
    expect(kbs.find).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' }, order: { createdAt: 'DESC' } });
    expect(dify.listDatasets).not.toHaveBeenCalled();
  });
  it('lists active managed documents and refreshes stale local indexing status', async () => {
    kbs.findOne.mockResolvedValue({ tenantId: 'tenant-a' });
    files.find.mockResolvedValue([
      { id: 'f1', difyDocumentId: 'current', isActive: true, syncStatus: 'waiting' },
      { id: 'f2', difyDocumentId: 'old', isActive: false },
    ]);
    dify.getDocumentStatus.mockResolvedValue(['current', 'old', 'unmanaged'].map(id => ({ id, indexing_status: 'completed' })));
    dify.getDocumentSegments.mockResolvedValue({ total: 10 });
    const rows = await controller.documents('dataset-a', 'tenant-a');
    expect(rows.map(r => r.id)).toEqual(['current']);
    expect(files.update).toHaveBeenCalledWith({ id: 'f1', tenantId: 'tenant-a', datasetId: 'dataset-a' }, { syncStatus: 'completed' });
  });

  it('rejects cross-tenant segment access before calling Dify', async () => {
    kbs.findOne.mockResolvedValue(null);
    await expect(controller.preview('dataset-b', 'document-1', 'tenant-a')).rejects.toThrow(/40401/);
    expect(dify.getDocumentSegments).not.toHaveBeenCalled();
  });
  it('passes the requested page and page size to Dify instead of always showing the first 20', async () => {
    kbs.findOne.mockResolvedValue({ tenantId: 'tenant-a' });
    dify.getDocumentSegments.mockResolvedValue({ list: [{ content: 'Last page' }], total: 7181, page: 360, limit: 20 });
    await expect(controller.preview('dataset-a', 'doc', 'tenant-a', '360', '20')).resolves.toMatchObject({ total: 7181, page: 360 });
    expect(dify.getDocumentSegments).toHaveBeenCalledWith('', 'dataset-a', 'doc', 20, 360);
  });
  it('rejects invalid pagination', async () => {
    kbs.findOne.mockResolvedValue({ tenantId: 'tenant-a' });
    await expect(controller.preview('dataset-a', 'doc', 'tenant-a', '0', '500')).rejects.toThrow('分页参数无效');
    expect(dify.getDocumentSegments).not.toHaveBeenCalled();
  });

  it('does not delete a Dify document without an owned local file record', async () => {
    files.findOne.mockResolvedValue(null);
    await expect(controller.remove('dataset-b', 'document-1', 'tenant-a')).rejects.toThrow(/40401/);
    expect(dify.deleteDocument).not.toHaveBeenCalled();
  });

  it('strips path components from uploaded file names', () => {
    expect((controller as any).safeFilename('../../private/contract.pdf')).toBe('contract.pdf');
  });
  it('downloads pipeline sources using a tenant-scoped ingestion job', async () => {
    const tenantId = 'download-regression-' + process.pid;
    const dir = join(process.cwd(), 'uploads', tenantId);
    const filePath = join(dir, 'source_fixture.txt');
    mkdirSync(dir, { recursive: true }); writeFileSync(filePath, 'fixture');
    try {
      files.findOne.mockResolvedValue({ name: 'answer.txt' });
      jobs.findOne.mockResolvedValue({ filePath });
      const res = { download: jest.fn() };
      await controller.download('dataset-a', 'document-a', tenantId, res as never);
      expect(res.download).toHaveBeenCalledWith(filePath, 'answer.txt');
      expect(jobs.findOne).toHaveBeenCalledWith({ where: { tenantId, datasetId: 'dataset-a', documentId: 'document-a' }, order: { createdAt: 'DESC' } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not download an ingestion path outside the tenant upload directory', async () => {
    files.findOne.mockResolvedValue({ name: 'answer.txt' });
    jobs.findOne.mockResolvedValue({ filePath: join(process.cwd(), 'package.json') });
    await expect(controller.download('dataset-a', 'document-a', 'missing-fixture-tenant', { download: jest.fn() } as never)).rejects.toThrow('本地副本不存在');
  });
});
