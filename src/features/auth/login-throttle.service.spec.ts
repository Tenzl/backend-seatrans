import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { LoginThrottleService } from './login-throttle.service';

function mockReq(ip = '203.0.113.10'): Request {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function service(env: Record<string, string> = {}): LoginThrottleService {
  return new LoginThrottleService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

describe('LoginThrottleService (SEC-04)', () => {
  it('locks out after N failures for the same IP + normalized identifier', () => {
    const throttle = service({
      LOGIN_MAX_FAILURES: '3',
      LOGIN_LOCKOUT_MS: '60000',
    });
    const req = mockReq();

    throttle.recordFailure(req, 'Admin@Example.COM');
    throttle.recordFailure(req, 'admin@example.com');
    expect(() => throttle.assertAllowed(req, 'admin@example.com')).not.toThrow();

    throttle.recordFailure(req, '  ADMIN@example.com ');
    expect(() => throttle.assertAllowed(req, 'admin@example.com')).toThrow(
      HttpException,
    );

    try {
      throttle.assertAllowed(req, 'admin@example.com');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });

  it('does not share lockout across different identifiers on the same IP', () => {
    const throttle = service({
      LOGIN_MAX_FAILURES: '2',
      LOGIN_LOCKOUT_MS: '60000',
    });
    const req = mockReq();

    throttle.recordFailure(req, 'alice@example.com');
    throttle.recordFailure(req, 'alice@example.com');
    expect(() =>
      throttle.assertAllowed(req, 'alice@example.com'),
    ).toThrow(HttpException);
    expect(() =>
      throttle.assertAllowed(req, 'bob@example.com'),
    ).not.toThrow();
  });

  it('clears the bucket after a successful login', () => {
    const throttle = service({
      LOGIN_MAX_FAILURES: '2',
      LOGIN_LOCKOUT_MS: '60000',
    });
    const req = mockReq();

    throttle.recordFailure(req, 'user@example.com');
    throttle.recordFailure(req, 'user@example.com');
    expect(() =>
      throttle.assertAllowed(req, 'user@example.com'),
    ).toThrow(HttpException);

    throttle.recordSuccess(req, 'user@example.com');
    expect(() =>
      throttle.assertAllowed(req, 'user@example.com'),
    ).not.toThrow();
  });

  it('increases delay with successive failures', () => {
    const throttle = service({ LOGIN_MAX_FAILURES: '10' });
    const req = mockReq();

    expect(throttle.delayMsFor(req, 'u@example.com')).toBe(0);
    throttle.recordFailure(req, 'u@example.com');
    expect(throttle.delayMsFor(req, 'u@example.com')).toBe(0);
    throttle.recordFailure(req, 'u@example.com');
    expect(throttle.delayMsFor(req, 'u@example.com')).toBeGreaterThan(0);
    const second = throttle.delayMsFor(req, 'u@example.com');
    throttle.recordFailure(req, 'u@example.com');
    expect(throttle.delayMsFor(req, 'u@example.com')).toBeGreaterThan(second);
  });

  it('ignores forged XFF / CF-Connecting-IP when TRUST_PROXY is off', () => {
    const throttle = service({
      LOGIN_MAX_FAILURES: '2',
      LOGIN_LOCKOUT_MS: '60000',
    });
    const socketIp = '203.0.113.10';
    const locked = {
      ip: socketIp,
      headers: { 'x-forwarded-for': '198.51.100.1' },
      socket: { remoteAddress: socketIp },
    } as unknown as Request;

    throttle.recordFailure(locked, 'admin@example.com');
    throttle.recordFailure(locked, 'admin@example.com');
    expect(() =>
      throttle.assertAllowed(locked, 'admin@example.com'),
    ).toThrow(HttpException);

    // Same socket IP with a rotated XFF must still be locked.
    const rotatedXff = {
      ip: socketIp,
      headers: { 'x-forwarded-for': '198.51.100.99' },
      socket: { remoteAddress: socketIp },
    } as unknown as Request;
    expect(() =>
      throttle.assertAllowed(rotatedXff, 'admin@example.com'),
    ).toThrow(HttpException);

    const forgedCf = {
      ip: socketIp,
      headers: { 'cf-connecting-ip': '198.51.100.50' },
      socket: { remoteAddress: socketIp },
    } as unknown as Request;
    expect(() =>
      throttle.assertAllowed(forgedCf, 'admin@example.com'),
    ).toThrow(HttpException);
  });

  it('uses CF-Connecting-IP when TRUST_PROXY is enabled', () => {
    const throttle = service({
      TRUST_PROXY: '1',
      LOGIN_MAX_FAILURES: '2',
      LOGIN_LOCKOUT_MS: '60000',
    });
    const edgeIp = '198.51.100.7';
    const req = {
      ip: '10.0.0.1',
      headers: { 'cf-connecting-ip': edgeIp },
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;

    expect(throttle.resolveClientIp(req)).toBe(edgeIp);
    throttle.recordFailure(req, 'admin@example.com');
    throttle.recordFailure(req, 'admin@example.com');
    expect(() =>
      throttle.assertAllowed(req, 'admin@example.com'),
    ).toThrow(HttpException);

    // Different CF IP is a different throttle bucket.
    const otherEdge = {
      ip: '10.0.0.1',
      headers: { 'cf-connecting-ip': '198.51.100.8' },
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;
    expect(() =>
      throttle.assertAllowed(otherEdge, 'admin@example.com'),
    ).not.toThrow();
  });
});
