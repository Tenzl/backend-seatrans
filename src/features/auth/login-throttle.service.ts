import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveTrustProxy } from '../../config/environment';
import { readPositiveInt } from '../../shared/utils/env-int';
import type { Request } from 'express';

type FailureBucket = {
  failures: number;
  lockedUntilMs: number;
  updatedAtMs: number;
};

/**
 * In-memory login throttle keyed by IP + normalized identifier.
 *
 * LIMITATION (multi-replica): each process keeps its own counters. Attackers
 * can multiply effective attempts by the replica count, and a lockout on one
 * pod does not apply on another. Prefer a shared store (Redis) or edge WAF
 * rules before running more than one replica in production.
 *
 * IP resolution: honors X-Forwarded-For / CF-Connecting-IP only when
 * TRUST_PROXY is enabled (API behind a known reverse proxy). Otherwise uses
 * the direct socket address so clients cannot rotate XFF to bypass lockout.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly buckets = new Map<string, FailureBucket>();
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly bucketTtlMs: number;
  private readonly trustProxy: boolean;

  constructor(configService: ConfigService) {
    this.maxFailures = readPositiveInt(
      configService.get<string>('LOGIN_MAX_FAILURES'),
      5,
      { min: 1, max: 50 },
    );
    this.lockoutMs = readPositiveInt(
      configService.get<string>('LOGIN_LOCKOUT_MS'),
      15 * 60_000,
      { min: 1_000, max: 24 * 60 * 60_000 },
    );
    // Keep failed buckets around a bit longer than lockout for exponential delay.
    this.bucketTtlMs = Math.max(this.lockoutMs * 2, 60 * 60_000);
    this.trustProxy =
      resolveTrustProxy({
        TRUST_PROXY: configService.get<string>('TRUST_PROXY'),
      }) !== false;

    // Opportunistic cleanup so long-running single replicas do not leak Map entries.
    const timer = setInterval(() => this.evictExpired(), 5 * 60_000);
    timer.unref?.();
  }

  normalizeIdentifier(identifier: string): string {
    return identifier.trim().toLowerCase();
  }

  resolveClientIp(req: Request): string {
    if (!this.trustProxy) {
      // Direct-to-origin: ignore client-controlled forwarding headers.
      return req.socket?.remoteAddress || req.ip || 'unknown';
    }

    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) {
      return cf.trim();
    }

    // With Express trust proxy set, req.ip is derived from trusted XFF hops.
    if (req.ip?.trim()) {
      return req.ip.trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  assertAllowed(req: Request, identifier: string): void {
    const key = this.bucketKey(req, identifier);
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket) return;

    if (bucket.lockedUntilMs > now) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((bucket.lockedUntilMs - now) / 1000),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many failed login attempts. Try again later.',
          retryAfterSeconds: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Exponential delay (ms) after successive failures, before hard lockout.
   * Returned so the controller can wait without holding a DB transaction.
   */
  delayMsFor(req: Request, identifier: string): number {
    const bucket = this.buckets.get(this.bucketKey(req, identifier));
    if (!bucket || bucket.failures <= 1) return 0;
    // 200ms, 400ms, 800ms, ... capped at 5s — slows online guessing without
    // holding the event loop for long on every attempt.
    const exp = Math.min(5_000, 200 * 2 ** Math.min(bucket.failures - 1, 5));
    return exp;
  }

  recordFailure(req: Request, identifier: string): void {
    const key = this.bucketKey(req, identifier);
    const now = Date.now();
    const existing = this.buckets.get(key);
    const failures = (existing?.failures ?? 0) + 1;
    const lockedUntilMs =
      failures >= this.maxFailures ? now + this.lockoutMs : 0;

    this.buckets.set(key, {
      failures,
      lockedUntilMs,
      updatedAtMs: now,
    });

    if (lockedUntilMs > 0) {
      this.logger.warn(
        `Login lockout for ${this.normalizeIdentifier(identifier)} from ${this.resolveClientIp(req)} after ${failures} failures`,
      );
    }
  }

  recordSuccess(req: Request, identifier: string): void {
    this.buckets.delete(this.bucketKey(req, identifier));
  }

  /** Test helper — clears all in-memory state. */
  resetForTests(): void {
    this.buckets.clear();
  }

  private bucketKey(req: Request, identifier: string): string {
    return `${this.resolveClientIp(req)}\0${this.normalizeIdentifier(identifier)}`;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      const stale =
        bucket.lockedUntilMs > 0
          ? bucket.lockedUntilMs + this.bucketTtlMs < now
          : bucket.updatedAtMs + this.bucketTtlMs < now;
      if (stale) {
        this.buckets.delete(key);
      }
    }
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
