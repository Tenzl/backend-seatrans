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
  ];
  const repository = {
    find: jest.fn().mockResolvedValue(rows),
  } as unknown as Repository<BookingPartner>;
  const validator = new BookingDocumentPayloadValidator(repository);

  it('accepts role-specific IDs and normalizes same-as values', async () => {
    const result = await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
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
        billToMode: 'SAME_AS_CONSIGNEE',
        to: '',
      },
    );

    expect(result).toMatchObject({
      notifyParty: 'Party 3',
      notifyPartyId: 3,
      to: 'Party 3',
    });
  });

  it('rejects an Agent ID that is not customerType AGENT', async () => {
    await expect(
      validator.validate(BookingDocumentType.BOOKING_CONFIRMATION, {
        agent: 'Party 1',
        agentPartyId: 1,
      }),
    ).rejects.toThrow('Agent Party must have customer type AGENT');
  });

  it('resets same-as modes when their source Party ID is missing', async () => {
    const result = await validator.validate(
      BookingDocumentType.BOOKING_CONFIRMATION,
      {
        consignee: 'Legacy free text',
        notifyParty: 'Legacy free text',
        notifyPartySameAsConsignee: true,
        billToMode: 'SAME_AS_CONSIGNEE',
        to: 'Legacy free text',
      },
    );

    expect(result).toMatchObject({
      notifyPartySameAsConsignee: false,
      notifyParty: '',
      billToMode: 'NONE',
      to: '',
    });
  });
});
