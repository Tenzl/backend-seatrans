import {
  formatBookingCargoVolumes,
  formatVolumeForBlPdf,
} from './cargo-volume';

describe('cargo-volume', () => {
  it('formats booking volume with spaces and quotes', () => {
    expect(formatBookingCargoVolumes({ "20'DC": 1, "40'RF": 2 })).toBe(
      "1 x 20'DC\n2 x 40'RF",
    );
  });

  it('formats BL PDF volume as compact STC line', () => {
    expect(formatVolumeForBlPdf({ "20'DC": 1 })).toBe(
      '1x20DC CONTAINER(S) S.T.C',
    );
    expect(formatVolumeForBlPdf({ "20'DC": 2, "40'RF": 1 })).toBe(
      '2x20DC 1x40RF CONTAINER(S) S.T.C',
    );
    expect(formatVolumeForBlPdf({})).toBe('');
  });
});
