import { BookingPartnerFieldChangeAction } from '../entities/booking-partner-field-change-log.entity';
import {
  diffPartnerFieldSnapshots,
  partnerFieldSnapshot,
} from './booking-partner-audit';
import { BookingPartner } from '../entities/booking-partner.entity';
import { BookingPartnerAdditionTypeEntity } from '../entities/booking-partner-addition-type.entity';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { CustomerStatus } from '../enums/customer-status.enum';

describe('booking-partner-audit', () => {
  const basePartner = (): BookingPartner => {
    const partner = new BookingPartner();
    partner.id = 1;
    partner.name = 'Acme';
    partner.customerId = 'C001';
    partner.additionTypeRows = [];
    partner.country = 'VN';
    partner.city = 'HCM';
    partner.contacts = [];
    partner.phone = null;
    partner.fax = null;
    partner.trackingUrl = null;
    partner.address = null;
    partner.customerStatus = CustomerStatus.LEAD;
    partner.customerType = null;
    partner.taxNumber = null;
    partner.approveStatus = null;
    partner.approveBy = null;
    partner.companyEstablishmentDate = null;
    partner.paymentDueDays = 30;
    partner.contractNo = null;
    partner.invoiceCompanyName = null;
    partner.invoiceCompanyAddress = null;
    partner.invoiceCompanyPhone = null;
    partner.invoiceCompanyEmail = null;
    partner.invoiceBankName = null;
    partner.invoiceBankBranch = null;
    partner.invoiceBankAccount = null;
    return partner;
  };

  it('snapshots addition types as sorted CSV', () => {
    const partner = basePartner();
    const a = new BookingPartnerAdditionTypeEntity();
    a.additionType = PartnerAdditionType.SHIPPER;
    const b = new BookingPartnerAdditionTypeEntity();
    b.additionType = PartnerAdditionType.CUSTOMER;
    partner.additionTypeRows = [a, b];

    const snap = partnerFieldSnapshot(partner);
    expect(snap['Addition types']).toBe('CUSTOMER,SHIPPER');
  });

  it('diffs only changed fields and normalizes numeric payment days', () => {
    const beforeRow = basePartner();
    const afterRow = basePartner();
    afterRow.name = 'Acme Updated';
    afterRow.paymentDueDays = 30;

    const changes = diffPartnerFieldSnapshots(
      partnerFieldSnapshot(beforeRow),
      partnerFieldSnapshot(afterRow),
    );

    expect(changes).toEqual([
      {
        field: 'Name',
        previousValue: 'Acme',
        newValue: 'Acme Updated',
      },
    ]);
  });

  it('exposes partner field-change action enums used by the service', () => {
    expect(BookingPartnerFieldChangeAction.PARTNER_CREATE).toBe(
      'PARTNER_CREATE',
    );
    expect(BookingPartnerFieldChangeAction.PARTNER_UPDATE).toBe(
      'PARTNER_UPDATE',
    );
    expect(BookingPartnerFieldChangeAction.PARTNER_LOCK).toBe('PARTNER_LOCK');
  });
});
