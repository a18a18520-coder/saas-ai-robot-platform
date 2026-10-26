import { ConfigService } from '@nestjs/config';
import { ChannelsController } from './channels.controller';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';

describe('ChannelsController credential storage', () => {
  const key = Buffer.alloc(32, 3).toString('base64');
  const secrets = new SecretsService(new ConfigService({ NODE_ENV: 'test', APP_ENCRYPTION_KEY: key }));
  const repo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: value.id ?? 'channel-1', createdAt: new Date(), ...value })),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const dingtalk = { isConnected: jest.fn(), testConnection: jest.fn(), start: jest.fn(), stop: jest.fn(), invalidate: jest.fn() };
  const feishu = { testConnection: jest.fn(), start: jest.fn(), stop: jest.fn() };
  const wecom = { testConnection: jest.fn() };
  const directorySync = { sync: jest.fn() };
  const controller = new ChannelsController(repo as never, audit as never, dingtalk as never, feishu as never, wecom as never, secrets, directorySync as never);

  beforeEach(() => jest.clearAllMocks());

  it('encrypts sensitive fields at rest and returns only masks', async () => {
    const result = await controller.create({ tenantId: 'tenant-a', type: 'wecom', config: { corp_id: 'corp', secret: 'plain', token: 'token', aes_key: 'aes' } });
    const stored = repo.save.mock.calls[0][0];
    expect(stored.config.secret).toMatch(/^enc:v1:/);
    expect(stored.config.secret).not.toContain('plain');
    expect(result.config).toEqual({ corp_id: 'corp', secret: MASKED_SECRET, token: MASKED_SECRET, aes_key: MASKED_SECRET });
  });

  it('migrates legacy plaintext on list and never returns ciphertext', async () => {
    repo.find.mockResolvedValue([{ id: 'channel-1', tenantId: 'tenant-a', type: 'feishu', config: { app_id: 'app', app_secret: 'legacy' } }]);
    const [result] = await controller.list('tenant-a');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ app_secret: expect.stringMatching(/^enc:v1:/) }) }));
    expect(result.config.app_secret).toBe(MASKED_SECRET);
  });

  it('reports offline Stream channels without losing the persisted restore flag', async () => {
    const channel = { id: 'channel-1', type: 'dingtalk', status: 'connected', config: { connection_mode: 'stream' } };
    repo.find.mockResolvedValue([channel]);
    dingtalk.isConnected.mockReturnValue(false);
    const [result] = await controller.list('tenant-a');
    expect(result.status).toBe('disconnected');
    expect(channel.status).toBe('connected');
    dingtalk.isConnected.mockReturnValue(true);
    expect((await controller.list('tenant-a'))[0].status).toBe('connected');
  });

  it('keeps the stored secret when a masked partial update is submitted', async () => {
    const encrypted = secrets.encrypt('existing')!;
    repo.findOne.mockResolvedValue({ id: 'channel-1', tenantId: 'tenant-a', type: 'feishu', config: { app_id: 'app', app_secret: encrypted } });
    await controller.updateConfig('channel-1', 'tenant-a', { config: { app_id: 'updated', app_secret: MASKED_SECRET } });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ config: { app_id: 'updated', app_secret: encrypted } }));
  });

  it('creates a non-enumerable site key for a web channel', async () => {
    const result = await controller.create({ tenantId: 'tenant-a', type: 'web', config: { domains: 'https://www.example.com' } });
    expect(result.config.site_key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ site_key: result.config.site_key }) }));
  });

  it('syncs the directory from the selected connected DingTalk channel', async () => {
    repo.findOne.mockResolvedValue({ id: 'channel-1', tenantId: 'tenant-a', type: 'dingtalk', status: 'connected' });
    directorySync.sync.mockResolvedValue({ channelId: 'channel-1', channel: 'dingtalk', fetched: 8, created: 5, updated: 3 });

    const result = await controller.syncDirectory('channel-1', 'tenant-a');

    expect(directorySync.sync).toHaveBeenCalledWith('tenant-a', 'channel-1');
    expect(result.data).toMatchObject({ fetched: 8, created: 5, updated: 3 });
  });
});
