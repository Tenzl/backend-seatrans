import { formatCommodityInGroupLabel } from './commodity-display-label';

describe('formatCommodityInGroupLabel', () => {
  it('uses exact "{commodity} IN {group}" with spaces around IN', () => {
    expect(formatCommodityInGroupLabel('Rice', 'Foodstuffs')).toBe(
      'Rice IN Foodstuffs',
    );
  });

  it('trims parts', () => {
    expect(formatCommodityInGroupLabel('  Stone  ', ' Minerals ')).toBe(
      'Stone IN Minerals',
    );
  });

  it('falls back when one side is empty', () => {
    expect(formatCommodityInGroupLabel('Rice', '')).toBe('Rice');
    expect(formatCommodityInGroupLabel('', 'Foodstuffs')).toBe('Foodstuffs');
  });
});
