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
      }),
    );
  });
});
