import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  liveness() {
    return { status: 'ok', service: 'backend', timestamp: new Date().toISOString() };
  }

  async readiness() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ready', checks: { database: 'up' }, timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', checks: { database: 'down' } });
    }
  }
}
