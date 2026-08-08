import { buildContainsLikePattern } from './like-pattern';

describe('buildContainsLikePattern', () => {
  it('escapes LIKE wildcards and wraps with %', () => {
    expect(buildContainsLikePattern('  100%_raw\\x  ')).toBe(
      '%100\\%\\_raw\\\\x%',
    );
  });
});
