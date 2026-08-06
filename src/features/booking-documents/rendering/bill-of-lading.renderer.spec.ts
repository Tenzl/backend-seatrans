import { buildBlCargoPdfRows } from '../an-container';
import {
  isBlCargoBlockBoundary,
  sumBlNumericCargoTotals,
} from './bill-of-lading.renderer';

describe('sumBlNumericCargoTotals', () => {
  it('sums packages / GW / measurement with the same qty+unit shape as each row', () => {
    const rows = buildBlCargoPdfRows({
      serviceMode: 'FCL/FCL - CY/CY',
      descriptionOfGoods: 'STONE',
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: 'S1',
          grossWeight: '20700',
          measurement: '7.45',
          tare: '',
          packageType: 'PALLETS',
          noOfPkgs: '20',
          note: '',
          method: '',
        },
        {
          type: "20'DC",
          containerNo: 'C2',
          sealNo: 'S2',
          grossWeight: '12000',
          measurement: '4.67',
          tare: '',
          packageType: 'PALLETS',
          noOfPkgs: '30',
          note: '',
          method: '',
        },
      ],
    });

    expect(sumBlNumericCargoTotals(rows)).toEqual({
      packages: '50 PALLETS',
      grossWeight: '32700 KGS',
      measurement: '12.12 CBM',
    });
  });

  it('omits the package-type suffix when container rows disagree', () => {
    const rows = buildBlCargoPdfRows({
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: '',
          grossWeight: '1000',
          measurement: '1',
          tare: '',
          packageType: 'PALLETS',
          noOfPkgs: '10',
          note: '',
          method: '',
        },
        {
          type: "20'DC",
          containerNo: 'C2',
          sealNo: '',
          grossWeight: '2000',
          measurement: '2',
          tare: '',
          packageType: 'CRATE(S)',
          noOfPkgs: '5',
          note: '',
          method: '',
        },
      ],
    });

    expect(sumBlNumericCargoTotals(rows)).toEqual({
      packages: '15',
      grossWeight: '3000 KGS',
      measurement: '3 CBM',
    });
  });

  it('returns null when no container row carries numeric cargo data', () => {
    const rows = buildBlCargoPdfRows({
      serviceMode: 'FCL/FCL - CY/CY',
      descriptionOfGoods: 'STONE',
      containers: [],
    });

    expect(sumBlNumericCargoTotals(rows)).toBeNull();
  });
});

describe('isBlCargoBlockBoundary', () => {
  // Regression for the "no gap between FCL header and Totals" bug: the old
  // heuristic checked `nextRow.marks.trim() === 'N/M'`, which never fires
  // between the FCL header and the first container row, so
  // CARGO_BLOCK_GAP_LINES silently never applied there.
  it('is a block boundary between the FCL header and the first container row', () => {
    const rows = buildBlCargoPdfRows({
      serviceMode: 'FCL/FCL - CY/CY',
      descriptionOfGoods: 'STONE',
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: 'S1',
          grossWeight: '20700',
          measurement: '7.45',
          tare: '',
          packageType: 'PALLETS',
          noOfPkgs: '20',
          note: '',
          method: '',
        },
      ],
    });

    const [fclHeader, container, shippingMark] = rows;
    expect(fclHeader.kind).toBe('fclHeader');
    expect(container.kind).toBe('container');
    expect(shippingMark.kind).toBe('shippingMark');

    expect(isBlCargoBlockBoundary(fclHeader, container)).toBe(true);
    expect(isBlCargoBlockBoundary(container, shippingMark)).toBe(true);
  });

  it('is not a block boundary between two container rows in the same Totals block', () => {
    const rows = buildBlCargoPdfRows({
      serviceMode: 'FCL/FCL - CY/CY',
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: 'S1',
          grossWeight: '1000',
          measurement: '1',
          tare: '',
          packageType: 'PALLETS',
          noOfPkgs: '10',
          note: '',
          method: '',
        },
        {
          type: "20'DC",
          containerNo: 'C2',
          sealNo: 'S2',
          grossWeight: '2000',
          measurement: '2',
          tare: '',
          packageType: 'PALLETS',
          noOfPkgs: '20',
          note: '',
          method: '',
        },
      ],
    });

    const [, firstContainer, secondContainer] = rows;
    expect(isBlCargoBlockBoundary(firstContainer, secondContainer)).toBe(
      false,
    );
  });

  it('is a block boundary directly from the FCL header to shipping mark when there are no containers', () => {
    const rows = buildBlCargoPdfRows({
      serviceMode: 'FCL/FCL - CY/CY',
      descriptionOfGoods: 'STONE',
      containers: [],
    });

    const [fclHeader, shippingMark] = rows;
    expect(fclHeader.kind).toBe('fclHeader');
    expect(shippingMark.kind).toBe('shippingMark');
    expect(isBlCargoBlockBoundary(fclHeader, shippingMark)).toBe(true);
  });
});
