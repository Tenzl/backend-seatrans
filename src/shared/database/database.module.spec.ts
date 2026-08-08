import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildDatabaseOptions } from './database.module';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('database connection configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails closed when production fallback credentials are incomplete', () => {
    expect(() =>
      buildDatabaseOptions(
        config({
          NODE_ENV: 'production',
          DB_HOST: 'db.example.test',
          DB_PORT: '5432',
          DB_USERNAME: 'app',
          DB_DATABASE: 'seatrans',
        }),
      ),
    ).toThrow('DB_PASSWORD');
  });

  it('does not log a DB URL, username, or password', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const databaseUrl =
      'postgresql://sensitive-user:sensitive-password@db.example.test:5432/seatrans';

    const options = buildDatabaseOptions(
      config({ NODE_ENV: 'production', DB_URL: databaseUrl }),
    );

    expect(options).toEqual(
      expect.objectContaining({
        host: 'db.example.test',
        database: 'seatrans',
      }),
    );
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(databaseUrl);
    expect(logged).not.toContain('sensitive-user');
    expect(logged).not.toContain('sensitive-password');
  });

  it('retains local development defaults', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    expect(buildDatabaseOptions(config({ NODE_ENV: 'development' }))).toEqual(
      expect.objectContaining({
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'seatrans',
        extra: expect.objectContaining({
          max: 10,
          connectionTimeoutMillis: 5000,
          options: expect.stringContaining('statement_timeout=30000'),
        }),
      }),
    );
  });

  it('applies explicit pool and timeout env overrides', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const options = buildDatabaseOptions(
      config({
        NODE_ENV: 'development',
        DB_POOL_MAX: '7',
        DB_POOL_CONNECTION_TIMEOUT_MS: '2500',
        DB_STATEMENT_TIMEOUT_MS: '12000',
        DB_LOCK_TIMEOUT_MS: '4000',
      }),
    );

    expect(options.extra).toEqual(
      expect.objectContaining({
        max: 7,
        connectionTimeoutMillis: 2500,
        options: '-c statement_timeout=12000 -c lock_timeout=4000',
      }),
    );
  });
});
