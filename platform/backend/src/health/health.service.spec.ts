import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports ready only when the database query succeeds', async () => {
    const query = jest.fn().mockResolvedValue([{ ok: 1 }]);
    await expect(new HealthService({ query } as any).readiness()).resolves.toMatchObject({ status: 'ready' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a service-unavailable error without leaking the database error', async () => {
    const service = new HealthService({ query: jest.fn().mockRejectedValue(new Error('password=secret')) } as any);
    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.readiness()).rejects.not.toThrow(/password=secret/);
  });
});
