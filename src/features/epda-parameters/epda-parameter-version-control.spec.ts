import { HttpException } from '@nestjs/common';
import { EpdaParameterVersionControl } from './epda-parameter-version-control';
import type { EpdaParameterSet } from './entities/epda-parameter-set.entity';

describe('EpdaParameterVersionControl production policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRequireVersion = process.env.EPDA_REQUIRE_EXPECTED_VERSION;

  afterEach(() => {
    restoreEnv('NODE_ENV', originalNodeEnv);
    restoreEnv('EPDA_REQUIRE_EXPECTED_VERSION', originalRequireVersion);
  });

  it('requires expectedVersion in production even with a stale false flag', () => {
    process.env.NODE_ENV = 'production';
    process.env.EPDA_REQUIRE_EXPECTED_VERSION = 'false';
    const versionControl = new EpdaParameterVersionControl('Test');
    const current = { version: 4 } as EpdaParameterSet;

    expect(() =>
      versionControl.assertExpectedVersion(current, undefined, 'Port 41'),
    ).toThrow(HttpException);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
