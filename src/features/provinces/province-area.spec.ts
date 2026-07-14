import {
  getProvinceAreaLabel,
  normalizeProvinceAreaCode,
} from './province-area';

describe('normalizeProvinceAreaCode', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    ['1', 1],
    ['2', 2],
    ['3', 3],
  ])('accepts canonical area %p', (input, expected) => {
    expect(normalizeProvinceAreaCode(input)).toBe(expected);
  });

  it.each(['NORTH', 'NORTHERN', 'MIDDLE', 'SOUTH', 'SOUTHERN', 'unknown'])(
    'rejects legacy area alias %s',
    (input) => {
      expect(normalizeProvinceAreaCode(input)).toBeNull();
    },
  );

  it.each([
    [1, 'AREA 1'],
    [2, 'AREA 2'],
    [3, 'AREA 3'],
  ])('uses canonical display label for area %p', (input, expected) => {
    expect(getProvinceAreaLabel(input)).toBe(expected);
  });
});
