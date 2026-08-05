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
  },
) =>
  ({
    id,
    name: `Party ${id}`,
    customerType: options.customerType ?? null,
    deletedAt: null,
    additionTypeRows: (options.additionTypes ?? []).map((additionType) => ({
      additionType,
    })),
  }) as BookingPartner;

describe('Booking document Party validation', () => {
  const rows = [
    partner(1, { additionTypes: [PartnerAdditionType.SHIPPER] }),
    partner(2, { customerType: CustomerType.AGENT }),
    partner(3, { additionTypes: [PartnerAdditionType.CONSIGNEE] }),
    partner(4, { additionTypes: [PartnerAdditionType.NOTIFY_PARTY] }),
    partner(5, { additionTypes: [PartnerAdditionType.CUSTOMER] }),
  ];
  const repository = {
    find: jest.fn().mockResolvedValue(rows),
  } as unknown as Repository<BookingPartner>;
  const validator = new BookingDocumentPayloadValidator(repository);

  it('normalizes the Booking Client from a CUSTOMER Party', async () => {
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
      notifyParty: 'Party 3',
      notifyPartyId: 3,
    });
  });

  it('rejects an Agent ID that is not customerType AGENT', async () => {
    await expect(
      validator.validate(BookingDocumentType.ARRIVAL_NOTICE, {
        agent: 'Party 1',
        agentPartyId: 1,
      }),
    ).rejects.toThrow('Agent Party must have customer type AGENT');
  });

  it('resets same-as modes when their source Party ID is missing', async () => {
    const result = await validator.validate(
      BookingDocumentType.ARRIVAL_NOTICE,
      {
        consignee: 'Legacy free text',
        notifyParty: 'Legacy free text',
        notifyPartySameAsConsignee: true,
      },
    );

    expect(result).toMatchObject({
      notifyPartySameAsConsignee: false,
      notifyParty: '',
    });
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
      deliverTo: 'Party 3',
      consigneePartyId: 3,
      notifyParty: 'Party 4',
      notifyPartyId: 4,
    });
  });
});
