import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

type HealthResponse = {
  status: 'ok';
};

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /** Process probe. It deliberately avoids all external dependencies. */
  @Get('live')
  liveness(): HealthResponse {
    return { status: 'ok' };
  }

  /** Traffic probe. A process is ready only after PostgreSQL responds. */
  @Get('ready')
  async readiness(): Promise<HealthResponse> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Service is not ready');
    }
  }
}
