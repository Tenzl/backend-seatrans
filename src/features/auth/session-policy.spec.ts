import {
  DEFAULT_SESSION_POLICY,
  loadSessionPolicyFromEnv,
  parseDurationToSeconds,
  remainingAbsoluteSeconds,
  resolveAbsoluteSeconds,
  shouldSlideSession,
} from './session-policy';

describe('session-policy', () => {
  describe('parseDurationToSeconds', () => {
    it('parses common duration strings', () => {
      expect(parseDurationToSeconds('15m', 0)).toBe(15 * 60);
      expect(parseDurationToSeconds('12h', 0)).toBe(12 * 3600);
      expect(parseDurationToSeconds('7d', 0)).toBe(7 * 24 * 3600);
      expect(parseDurationToSeconds('90', 0)).toBe(90);
    });

    it('falls back on invalid input', () => {
      expect(parseDurationToSeconds('nope', 42)).toBe(42);
      expect(parseDurationToSeconds(undefined, 42)).toBe(42);
    });
  });

  describe('resolveAbsoluteSeconds', () => {
    const policy = DEFAULT_SESSION_POLICY;

    it('uses standard absolute for internal even with remember', () => {
      expect(
        resolveAbsoluteSeconds(policy, {
          remember: true,
          roleGroup: 'INTERNAL',
        }),
      ).toBe(policy.absoluteSeconds);
    });

    it('uses remember absolute only for external + remember', () => {
      expect(
        resolveAbsoluteSeconds(policy, {
          remember: true,
          roleGroup: 'EXTERNAL',
        }),
      ).toBe(policy.absoluteRememberSeconds);
      expect(
        resolveAbsoluteSeconds(policy, {
          remember: false,
          roleGroup: 'EXTERNAL',
        }),
      ).toBe(policy.absoluteSeconds);
    });
  });

  describe('shouldSlideSession', () => {
    const now = 1_700_000_000;

    it('slides when remaining TTL is within the threshold', () => {
      expect(shouldSlideSession(now + 10 * 60, 15 * 60, now)).toBe(true);
      expect(shouldSlideSession(now + 20 * 60, 15 * 60, now)).toBe(false);
      expect(shouldSlideSession(now - 1, 15 * 60, now)).toBe(false);
    });
  });

  describe('remainingAbsoluteSeconds', () => {
    it('counts down from auth_time', () => {
      const authTime = 1_000;
      expect(remainingAbsoluteSeconds(authTime, 100, 1_050)).toBe(50);
      expect(remainingAbsoluteSeconds(authTime, 100, 1_100)).toBe(0);
      expect(remainingAbsoluteSeconds(authTime, 100, 1_200)).toBe(-100);
    });
  });

  describe('loadSessionPolicyFromEnv', () => {
    it('reads env overrides', () => {
      const policy = loadSessionPolicyFromEnv({
        get: (key, defaultValue) => {
          const map: Record<string, string> = {
            APP_JWT_IDLE: '30m',
            APP_JWT_SLIDE_BEFORE: '5m',
            APP_JWT_ABSOLUTE: '8h',
            APP_JWT_ABSOLUTE_REMEMBER: '3d',
          };
          return map[key] ?? defaultValue;
        },
      });
      expect(policy.idleSeconds).toBe(30 * 60);
      expect(policy.slideBeforeSeconds).toBe(5 * 60);
      expect(policy.absoluteSeconds).toBe(8 * 3600);
      expect(policy.absoluteRememberSeconds).toBe(3 * 24 * 3600);
    });
  });
});
