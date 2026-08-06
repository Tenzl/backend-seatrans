import { Repository } from 'typeorm';
import { BookingPartner } from '../booking/entities/booking-partner.entity';
import { CustomerType } from '../booking/enums/customer-type.enum';
import { PartnerAdditionType } from '../booking/enums/partner-addition-type.enum';
import { BookingDocumentPayloadValidator } from './booking-document-payload.validator';
import { BookingDocumentType } from './enums/booking-document-type.enum';

const partner = (
  id: number,
  options: {
    customerType?: CustomerType;
    additionTypes?: PartnerAdditionType[];
    address?: string;
    city?: string;
    country?: string;
    phone?: string;
    fax?: string;
  },
) =>
  ({
    id,
    name: `Party ${id}`,
    address: options.address ?? null,
    city: options.city ?? null,
    country: options.country ?? null,
    phone: options.phone ?? null,
    fax: options.fax ?? null,
    customerType: options.customerType ?? null,
    deletedAt: null,
    additionTypeRows: (options.additionTypes ?? []).map((additionType) => ({
      additionType,
    })),
  }) as BookingPartner;

describe('Booking document Party validation', () => {
  const rows = [
    partner(1, {
      additionTypes: [PartnerAdditionType.SHIPPER],
      address: 'Shipper St 1',
      phone: '011',
    }),
    partner(2, {
      customerType: CustomerType.AGENT,
      address: 'Agent Ave 9',
      city: 'Da Nang',
      country: 'Vietnam',
      phone: '090999',
      fax: '0236999',
    }),
    partner(3, {
      additionTypes: [PartnerAdditionType.CONSIGNEE],
      address: 'Consignee Rd',
      phone: '022',
    }),
    partner(4, { additionTypes: [PartnerAdditionType.NOTIFY_PARTY] }),
    partner(5, {
      additionTypes: [PartnerAdditionType.CUSTOMER],
      address: '123 Harbor Rd',
      city: 'Ho Chi Minh',
      country: 'Vietnam',
      phone: '0901234567',
      fax: '0281234567',
    }),
  ];
  const repository = {
    find: jest.fn().mockResolvedValue(rows),
  } as unknown as Repository<BookingPartner>;
  const validator = new BookingDocumentPayloadValidator(repository);

  it('normalizes the Booking Client To field to name only', async () => {
    const result = await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        to: 'Stale client text',
        clientPartyId: 5,
      },
    );

    expect(result).toMatchObject({
      to: 'Party 5',
      clientPartyId: 5,
    });
    expect(result.to).not.toContain('123 Harbor Rd');
    expect(result.to).not.toContain('TEL:');
    expect(result.to).not.toContain('FAX:');
  });

  it('normalizes Booking cargoVolumes and derives multiline volume text', async () => {
    const result = await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        cargoVolumes: {
          "20'DC": 3,
          "40'RF": 1,
          "40'HC": 0,
        },
        volume: '',
      },
    );

    expect(result).toMatchObject({
      cargoVolumes: {
        "20'DC": 3,
        "40'RF": 1,
      },
      volume: "3 x 20'DC\n1 x 40'RF",
    });
  });

  it('normalizes AN containers and derives PDF cargoRows', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        descriptionOfGoods: 'STONE',
        containers: [
          {
            type: "20'DC",
            containerNo: 'SITU2608023',
            sealNo: 'SITR892061',
            grossWeight: '21000',
            measurement: '7.86',
            packageType: 'CRATE(S)',
            noOfPkgs: '21',
            note: 'row note',
          },
        ],
      },
    );

    expect(result).toMatchObject({
      descriptionOfGoods: 'STONE',
      containers: [
        {
          type: "20'DC",
          containerNo: 'SITU2608023',
          sealNo: 'SITR892061',
          grossWeight: '21000',
          measurement: '7.86',
          packageType: 'CRATE(S)',
          noOfPkgs: '21',
        },
      ],
      volume: "1 x 20'DC",
      cargoRows: [
        {
          containerSealNumber: "SITU2608023 / SITR892061 / 20'DC",
          quantity: '21 CRATE(S)',
          descriptionOfGoods: 'STONE',
          grossWeight: '21000',
          measurement: '7.86',
        },
      ],
    });
  });

  it('migrates legacy AN cargoRows into containers', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        cargoRows: [
          {
            containerSealNumber: 'CONT / SEAL',
            quantity: '10',
            descriptionOfGoods: 'STONE',
            grossWeight: '100',
            measurement: '2',
          },
        ],
      },
    );

    expect(result).toMatchObject({
      descriptionOfGoods: 'STONE',
      containers: [
        {
          containerNo: 'CONT',
          sealNo: 'SEAL',
          noOfPkgs: '10',
          note: 'STONE',
          grossWeight: '100',
          measurement: '2',
        },
      ],
    });
  });

  it('normalizes BL containers and derives free-text PDF cargo fields', async () => {
    const result = await validator.validate(
      BookingDocumentType.BILL_OF_LADING,
      {
        descriptionOfGoods: 'STONE',
        containers: [
          {
            type: "20'DC",
            containerNo: 'SITU2608023',
            sealNo: 'SITR892061',
            grossWeight: '21000',
            measurement: '7.86',
            packageType: 'CRATE(S)',
            noOfPkgs: '21',
            note: 'row note',
          },
        ],
      },
    );

    expect(result).toMatchObject({
      containers: [
        {
          type: "20'DC",
          containerNo: 'SITU2608023',
          sealNo: 'SITR892061',
          grossWeight: '21000',
          measurement: '7.86',
          packageType: 'CRATE(S)',
          noOfPkgs: '21',
          note: 'row note',
        },
      ],
      descriptionOfGoods: 'STONE',
      numberAndKindOfPackages: '21 CRATE(S)',
      grossWeight: '21000',
      measurement: '7.86',
    });
  });

  it('migrates legacy BL free-text cargo into containers', async () => {
    const result = await validator.validate(
      BookingDocumentType.BILL_OF_LADING,
      {
        descriptionOfGoods: "20'DC\nSTONE",
        grossWeight: '100',
        measurement: '2',
        numberAndKindOfPackages: '10 PKGS',
      },
    );

    expect(result).toMatchObject({
      containers: [
        {
          note: "20'DC\nSTONE",
          grossWeight: '100',
          measurement: '2',
          noOfPkgs: '10',
          packageType: 'PKGS',
        },
      ],
      descriptionOfGoods: "20'DC\nSTONE",
      grossWeight: '100',
      measurement: '2',
    });
  });

  it('hydrates BL descriptionOfGoods from legacy container note when empty', async () => {
    const result = await validator.validate(
      BookingDocumentType.BILL_OF_LADING,
      {
        containers: [
          {
            type: "20'DC",
            note: 'LEGACY STONE',
            grossWeight: '100',
            measurement: '2',
          },
        ],
      },
    );

    expect(result).toMatchObject({
      descriptionOfGoods: 'LEGACY STONE',
      grossWeight: '100',
      measurement: '2',
    });
  });

  it('rejects a Booking Client without the CUSTOMER addition type', async () => {
    await expect(
      validator.validate(BookingDocumentType.BOOKING_CONFIRMATION, {
        to: 'Wrong role',
        clientPartyId: 1,
      }),
    ).rejects.toThrow('Client Party must have addition type CUSTOMER');
  });

  it('accepts AN role-specific IDs and normalizes same-as values', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        shipper: 'Party 1',
        shipperPartyId: 1,
        agent: 'Party 2',
        agentPartyId: 2,
        consignee: 'Party 3',
        consigneePartyId: 3,
        notifyParty: '',
        notifyPartyId: null,
        notifyPartySameAsConsignee: true,
      },
    );

    expect(result).toMatchObject({
      notifyPartyId: 3,
    });
    // Agent: full party block in payload; PDF draws name via partyDisplayName.
    expect(result.agent).toContain('Party 2');
    expect(result.agent).toContain('Agent Ave 9');
    expect(result.agent).toContain('TEL: 090999');
    expect(result.agent).toContain('FAX: 0236999');
    // Other parties keep full address blocks.
    expect(result.shipper).toContain('Shipper St 1');
    expect(result.consignee).toContain('Consignee Rd');
    expect(result.notifyParty).toContain('Consignee Rd');
  });

  it('rejects an Agent ID that is not customerType AGENT', async () => {
    await expect(
      validator.validate(BookingDocumentType.ARRIVAL_NOTICE, {
        agent: 'Party 1',
        agentPartyId: 1,
      }),
    ).rejects.toThrow('Agent Party must have customer type AGENT');
  });

  it('keeps same-as with free-text Consignee when Party ID is missing', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        consignee: 'Legacy free text',
        notifyParty: 'Stale notify',
        notifyPartySameAsConsignee: true,
      },
    );

    expect(result).toMatchObject({
      notifyPartySameAsConsignee: true,
      notifyParty: 'Legacy free text',
    });
    expect(result.notifyPartyId).toBeUndefined();
  });

  it('resets same-as when Consignee has neither Party ID nor text', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        consignee: '   ',
        notifyParty: 'Stale notify',
        notifyPartySameAsConsignee: true,
      },
    );

    expect(result).toMatchObject({
      notifyPartySameAsConsignee: false,
      notifyParty: '',
    });
  });

  it('preserves same-as flag when Consignee Party ID is present', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        consignee: 'Party 3',
        consigneePartyId: 3,
        notifyParty: '',
        notifyPartyId: null,
        notifyPartySameAsConsignee: true,
      },
    );

    expect(result).toMatchObject({
      notifyPartySameAsConsignee: true,
      notifyPartyId: 3,
    });
    expect(result.notifyParty).toContain('Consignee Rd');
  });

  it('normalizes Delivery Order delivery and notify parties independently', async () => {
    const result = await validator.validate(
      BookingDocumentType.DELIVERY_ORDER,
      {
        deliverTo: 'Stale consignee',
        consigneePartyId: 3,
        notifyParty: 'Stale notify',
        notifyPartyId: 4,
      },
    );

    expect(result).toMatchObject({
      consigneePartyId: 3,
      notifyParty: 'Party 4',
      notifyPartyId: 4,
    });
    expect(result.deliverTo).toContain('Party 3');
    expect(result.deliverTo).toContain('Consignee Rd');
  });
});
