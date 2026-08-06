import {
  anContainersToBlCargoTextFields,
  anContainersToCargoRows,
  anContainersToPackagesText,
  anContainersToVolumeText,
  buildBlCargoPdfRows,
  legacyBlCargoTextToContainers,
  normalizeAnContainersPayload,
  syncBillOfLadingCargoFromArrivalNotice,
  syncDeliveryOrderCargoFromArrivalNotice,
} from './an-container';

describe('an-container', () => {
  it('normalizes containers and migrates legacy cargoRows', () => {
    expect(
      normalizeAnContainersPayload({
        cargoRows: [
          {
            containerSealNumber: 'SITU2608023 / SITR892061',
            quantity: '21',
            descriptionOfGoods: 'STONE',
            grossWeight: '21000',
            measurement: '7.86',
          },
        ],
      }),
    ).toEqual([
      {
        type: '',
        containerNo: 'SITU2608023',
        sealNo: 'SITR892061',
        grossWeight: '21000',
        measurement: '7.86',
        tare: '',
        packageType: '',
        noOfPkgs: '21',
        note: 'STONE',
        method: '',
      },
    ]);
  });

  it('formats one PDF cargo row per container', () => {
    expect(
      anContainersToCargoRows(
        [
          {
            type: "20'DC",
            containerNo: 'SITU2608023',
            sealNo: 'SITR892061',
            grossWeight: '21000',
            measurement: '7.86',
            tare: '',
            packageType: 'CRATE(S)',
            noOfPkgs: '21',
            note: '',
            method: '',
          },
        ],
        'STONE',
      ),
    ).toEqual([
      {
        containerSealNumber: "SITU2608023 / SITR892061 / 20'DC",
        quantity: '21 CRATE(S)',
        descriptionOfGoods: 'STONE',
        grossWeight: '21000 KGS',
        measurement: '7.86 CBM',
      },
    ]);
  });

  it('appends KGS/CBM on every DO cargo row, not only the first', () => {
    expect(
      anContainersToCargoRows(
        [
          {
            type: "20'DC",
            containerNo: 'A',
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
            containerNo: 'B',
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
        'GOODS',
      ),
    ).toEqual([
      {
        containerSealNumber: "A / S1 / 20'DC",
        quantity: '20 PALLETS',
        descriptionOfGoods: 'GOODS',
        grossWeight: '20700 KGS',
        measurement: '7.45 CBM',
      },
      {
        containerSealNumber: "B / S2 / 20'DC",
        quantity: '30 PALLETS',
        descriptionOfGoods: 'GOODS',
        grossWeight: '12000 KGS',
        measurement: '4.67 CBM',
      },
    ]);
  });

  it('prefers per-container note over shipment description on each row', () => {
    expect(
      anContainersToCargoRows(
        [
          {
            type: "20'DC",
            containerNo: 'A',
            sealNo: 'S1',
            grossWeight: '100',
            measurement: '1',
            tare: '',
            packageType: 'PKGS',
            noOfPkgs: '1',
            note: 'ROW ONE GOODS',
            method: '',
          },
          {
            type: "40'HC",
            containerNo: 'B',
            sealNo: 'S2',
            grossWeight: '200',
            measurement: '2',
            tare: '',
            packageType: 'PKGS',
            noOfPkgs: '2',
            note: 'ROW TWO GOODS',
            method: '',
          },
        ],
        'SHIPMENT FALLBACK',
      ),
    ).toEqual([
      {
        containerSealNumber: "A / S1 / 20'DC",
        quantity: '1 PKGS',
        descriptionOfGoods: 'ROW ONE GOODS',
        grossWeight: '100 KGS',
        measurement: '1 CBM',
      },
      {
        containerSealNumber: "B / S2 / 40'HC",
        quantity: '2 PKGS',
        descriptionOfGoods: 'ROW TWO GOODS',
        grossWeight: '200 KGS',
        measurement: '2 CBM',
      },
    ]);
  });

  it('flattens containers into BL free-text cargo columns', () => {
    expect(
      anContainersToBlCargoTextFields(
        [
          {
            type: "20'DC",
            containerNo: 'C1',
            sealNo: '',
            grossWeight: '100',
            measurement: '2',
            tare: '',
            packageType: '',
            noOfPkgs: '',
            note: 'ignored',
            method: '',
          },
        ],
        'STONE',
      ),
    ).toEqual({
      descriptionOfGoods: 'STONE',
      grossWeight: '100 KGS',
      measurement: '2 CBM',
      volumeStc: '1x20DC CONTAINER(S) S.T.C',
      numberAndKindOfPackages: '',
    });
  });

  it('formats per-container noOfPkgs + packageType for BL packages column', () => {
    expect(
      anContainersToPackagesText([
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: 'CRATE(S)',
          noOfPkgs: '21',
          note: '',
          method: '',
        },
      ]),
    ).toBe('21 CRATE(S)');

    expect(
      anContainersToPackagesText([
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: 'PALLET',
          noOfPkgs: '10',
          note: '',
          method: '',
        },
        {
          type: "20'DC",
          containerNo: 'C2',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: 'PALLET',
          noOfPkgs: '11',
          note: '',
          method: '',
        },
      ]),
    ).toBe('10 PALLET\n11 PALLET');

    expect(
      anContainersToPackagesText([
        {
          type: "20'DC",
          containerNo: 'C1',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: 'CRATE(S)',
          noOfPkgs: '21',
          note: '',
          method: '',
        },
        {
          type: "40'HC",
          containerNo: 'C2',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: 'PALLET',
          noOfPkgs: '5',
          note: '',
          method: '',
        },
      ]),
    ).toBe('21 CRATE(S)\n5 PALLET');
  });

  it('builds aligned BL PDF cargo rows: service, containers, shipping mark', () => {
    expect(
      buildBlCargoPdfRows({
        serviceMode: 'FCL/FCL - CY/CY',
        descriptionOfGoods: 'STONE IN CRATES',
        shippingMark: 'ABC MARK\nLINE 2',
        containers: [
          {
            type: "20'DC",
            containerNo: 'SITU2608023',
            sealNo: 'SITR892061',
            grossWeight: '21000',
            measurement: '7.86',
            tare: '',
            packageType: 'CRATE(S)',
            noOfPkgs: '21',
            note: '',
            method: '',
          },
          {
            type: "40'HC",
            containerNo: 'C2',
            sealNo: 'S2',
            grossWeight: '18000',
            measurement: '55',
            tare: '',
            packageType: 'PALLET',
            noOfPkgs: '5',
            note: '',
            method: '',
          },
        ],
      }),
    ).toEqual([
      {
        marks: 'FCL/FCL - CY/CY',
        packages: '',
        description: '1x20DC 1x40HC CONTAINER(S) S.T.C',
        grossWeight: '',
        measurement: '',
        kind: 'fclHeader',
      },
      {
        marks: "SITU2608023 / SITR892061 / 20'DC",
        packages: '21 CRATE(S)',
        description: '',
        grossWeight: '21000 KGS',
        measurement: '7.86 CBM',
        kind: 'container',
      },
      {
        marks: "C2 / S2 / 40'HC",
        packages: '5 PALLET',
        description: '',
        grossWeight: '18000 KGS',
        measurement: '55 CBM',
        kind: 'container',
      },
      {
        marks: 'ABC MARK\nLINE 2',
        packages: '',
        description: 'STONE IN CRATES',
        grossWeight: '',
        measurement: '',
        kind: 'shippingMark',
      },
    ]);
  });

  it('prints empty shipping mark when unset (no auto N/M)', () => {
    expect(
      buildBlCargoPdfRows({
        descriptionOfGoods: 'GOODS',
        containers: [],
      }),
    ).toEqual([
      {
        marks: '',
        packages: '',
        description: 'GOODS',
        grossWeight: '',
        measurement: '',
        kind: 'shippingMark',
      },
    ]);
  });

  it('builds BL STC volume line from typed container counts', () => {
    expect(
      anContainersToBlCargoTextFields(
        [
          {
            type: "20'DC",
            containerNo: '',
            sealNo: '',
            grossWeight: '',
            measurement: '',
            tare: '',
            packageType: '',
            noOfPkgs: '',
            note: '',
            method: '',
          },
          {
            type: "20'DC",
            containerNo: '',
            sealNo: '',
            grossWeight: '',
            measurement: '',
            tare: '',
            packageType: '',
            noOfPkgs: '',
            note: '',
            method: '',
          },
          {
            type: "40'RF",
            containerNo: '',
            sealNo: '',
            grossWeight: '',
            measurement: '',
            tare: '',
            packageType: '',
            noOfPkgs: '',
            note: '',
            method: '',
          },
        ],
        '',
      ).volumeStc,
    ).toBe('2x20DC 1x40RF CONTAINER(S) S.T.C');
  });

  it('seeds one container from legacy BL free-text without splitting lines', () => {
    expect(
      legacyBlCargoTextToContainers({
        descriptionOfGoods: "20'DC\nSTONE",
        grossWeight: '100\n200',
        measurement: '2',
        numberAndKindOfPackages: '10 PKGS',
      }),
    ).toEqual([
      {
        type: '',
        containerNo: '',
        sealNo: '',
        grossWeight: '100\n200',
        measurement: '2',
        tare: '',
        packageType: 'PKGS',
        noOfPkgs: '10',
        note: "20'DC\nSTONE",
        method: '',
      },
    ]);
  });

  it('does not silently drop rows above 20 (schema/DTO enforce the cap)', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      type: "20'DC" as const,
      containerNo: `C${index}`,
      sealNo: '',
      grossWeight: '',
      measurement: '',
      tare: '',
      packageType: '',
      noOfPkgs: '',
      note: '',
      method: '',
    }));
    expect(normalizeAnContainersPayload({ containers: rows })).toHaveLength(25);
  });

  it('formats Volume text from typed container counts', () => {
    expect(
      anContainersToVolumeText([
        {
          type: "20'DC",
          containerNo: '',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: '',
          noOfPkgs: '',
          note: '',
          method: '',
        },
        {
          type: "20'DC",
          containerNo: '',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: '',
          noOfPkgs: '',
          note: '',
          method: '',
        },
        {
          type: "40'RF",
          containerNo: '',
          sealNo: '',
          grossWeight: '',
          measurement: '',
          tare: '',
          packageType: '',
          noOfPkgs: '',
          note: '',
          method: '',
        },
      ]),
    ).toBe("2 x 20'DC\n1 x 40'RF");
    expect(anContainersToVolumeText([])).toBe('');
  });

  it('syncs BL cargo from AN without touching other BL fields', () => {
    const next = syncBillOfLadingCargoFromArrivalNotice(
      {
        marks: 'NEW MARKS',
        volume: 'fallback',
        descriptionOfGoods: 'STONE',
        serviceMode: 'FCL/FCL - CY/CY',
        containers: [
          {
            type: "20'DC",
            containerNo: 'C1',
            sealNo: 'S1',
            grossWeight: '500',
            measurement: '8',
            tare: '',
            packageType: 'PKGS',
            noOfPkgs: '3',
            note: '',
            method: '',
          },
        ],
      },
      {
        fblNumber: 'BL-1',
        consignor: 'KEEP SHIPPER',
        freightTerms: 'PREPAID',
        shippingMark: 'OLD',
        descriptionOfGoods: 'OLD DESC',
        serviceMode: 'OLD MODE',
        containers: [
          {
            type: "40'HC",
            containerNo: 'OLD',
            sealNo: '',
            grossWeight: '1',
            measurement: '1',
            tare: '',
            packageType: '',
            noOfPkgs: '1',
            note: '',
            method: '',
          },
        ],
      },
    );

    expect(next.fblNumber).toBe('BL-1');
    expect(next.consignor).toBe('KEEP SHIPPER');
    expect(next.freightTerms).toBe('PREPAID');
    expect(next.shippingMark).toBe('OLD');
    expect(next.descriptionOfGoods).toBe('STONE');
    expect(next.serviceMode).toBe('FCL/FCL - CY/CY');
    expect(next.numberAndKindOfPackages).toBe('3 PKGS');
    expect(next.grossWeight).toBe('500 KGS');
    expect(next.measurement).toBe('8 CBM');
    expect(next.containers).toEqual([
      {
        type: "20'DC",
        containerNo: 'C1',
        sealNo: 'S1',
        grossWeight: '500',
        measurement: '8',
        tare: '',
        packageType: 'PKGS',
        noOfPkgs: '3',
        note: '',
        method: '',
      },
    ]);
  });

  it('syncs DO cargo/container rows from AN without touching other DO fields', () => {
    const next = syncDeliveryOrderCargoFromArrivalNotice(
      {
        serviceMode: 'CY/CY',
        descriptionOfGoods: 'UPDATED STONE',
        containers: [
          {
            type: "20'DC",
            containerNo: 'C1',
            sealNo: 'S1',
            grossWeight: '500',
            measurement: '8',
            tare: '',
            packageType: 'PKGS',
            noOfPkgs: '3',
            note: '',
            method: '',
          },
        ],
      },
      {
        doNumber: 'DO-1',
        deliverTo: 'KEEP CONSIGNEE',
        marks: 'KEEP MARKS',
        serviceMode: 'OLD MODE',
        descriptionOfGoods: 'OLD DESC',
        containers: [
          {
            type: "40'HC",
            containerNo: 'OLD',
            sealNo: '',
            grossWeight: '1',
            measurement: '1',
            tare: '',
            packageType: '',
            noOfPkgs: '1',
            note: '',
            method: '',
          },
        ],
        cargoRows: [
          {
            containerSealNumber: 'OLD',
            quantity: '1',
            descriptionOfGoods: '',
            grossWeight: '1',
            measurement: '1',
          },
        ],
      },
    );

    expect(next.doNumber).toBe('DO-1');
    expect(next.deliverTo).toBe('KEEP CONSIGNEE');
    expect(next.marks).toBe('KEEP MARKS');
    expect(next.serviceMode).toBe('CY/CY');
    expect(next.descriptionOfGoods).toBe('UPDATED STONE');
    expect(next.containers).toEqual([
      {
        type: "20'DC",
        containerNo: 'C1',
        sealNo: 'S1',
        grossWeight: '500',
        measurement: '8',
        tare: '',
        packageType: 'PKGS',
        noOfPkgs: '3',
        note: '',
        method: '',
      },
    ]);
    expect(next.cargoRows).toEqual([
      {
        containerSealNumber: "C1 / S1 / 20'DC",
        quantity: '3 PKGS',
        descriptionOfGoods: 'UPDATED STONE',
        grossWeight: '500 KGS',
        measurement: '8 CBM',
      },
    ]);
  });

  it('falls back to a single empty container when AN has none for DO sync', () => {
    const next = syncDeliveryOrderCargoFromArrivalNotice(
      { containers: [] },
      { doNumber: 'DO-2', containers: [], cargoRows: [] },
    );
    expect(next.containers).toHaveLength(1);
    expect(next.cargoRows).toHaveLength(1);
  });
});
