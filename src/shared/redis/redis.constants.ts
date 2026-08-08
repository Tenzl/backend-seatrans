export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type RedisClientLike = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode?: 'PX' | 'EX',
    time?: number,
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
  duplicate(): RedisClientLike;
  status: string;
};
