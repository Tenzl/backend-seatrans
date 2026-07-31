import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports liveness without querying dependencies', () => {
    const query = jest.fn();
    const dataSource = { query } as unknown as DataSource;
    const controller = new HealthController(dataSource);

    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness after PostgreSQL responds', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const dataSource = {
      query,
    } as unknown as DataSource;
    const controller = new HealthController(dataSource);

    await expect(controller.readiness()).resolves.toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('does not expose database errors through readiness', async () => {
    const dataSource = {
      query: jest.fn().mockRejectedValue(new Error('host=secret-db')),
    } as unknown as DataSource;
    const controller = new HealthController(dataSource);

    await expect(controller.readiness()).rejects.toEqual(
      new ServiceUnavailableException('Service is not ready'),
    );
  });
});
