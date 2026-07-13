import { resolveDatabaseSsl } from './database-ssl';

describe('resolveDatabaseSsl', () => {
  it.each(['verify-ca', 'verify-full'])(
    'cannot silently weaken sslmode=%s with rejectUnauthorized=false',
    (sslMode) => {
      expect(
        resolveDatabaseSsl({
          sslMode,
          rejectUnauthorized: 'false',
        }),
      ).toEqual({ rejectUnauthorized: true });
    },
  );

  it('allows encryption-only require mode to use a managed CA override', () => {
    expect(
      resolveDatabaseSsl({
        sslMode: 'require',
        rejectUnauthorized: 'false',
      }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('does not enable SSL without an explicit flag or URL sslmode', () => {
    expect(resolveDatabaseSsl({})).toBeUndefined();
  });
});
