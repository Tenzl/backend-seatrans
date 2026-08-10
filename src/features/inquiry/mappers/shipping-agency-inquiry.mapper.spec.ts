import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { mapShippingAgencyInquiryFields } from './shipping-agency-inquiry.mapper';

describe('shipping agency inquiry parties', () => {
  const client = {
    id: 10,
    fullName: 'Client User',
    email: 'client@example.com',
  };
  const employee = {
    id: 99,
    fullName: 'Employee User',
    email: 'employee@example.com',
  };

  it('returns the employee and no client for an internally-created EPDA', () => {
    const result = mapShippingAgencyInquiryFields(
      {
        createdSource: InquiryCreatedSource.INTERNAL_EPDA,
        user: employee,
        processedBy: employee,
      } as ShippingAgencyInquiryEntity,
      'admin',
    );

    expect(result.employeeInCharge).toEqual(employee);
    expect(result.clientSubmittedBy).toBeNull();
  });

  it('returns the submitting client for a customer-portal inquiry', () => {
    const result = mapShippingAgencyInquiryFields(
      {
        createdSource: InquiryCreatedSource.CUSTOMER_PORTAL,
        user: client,
        processedBy: employee,
      } as ShippingAgencyInquiryEntity,
      'admin',
    );

    expect(result.employeeInCharge).toEqual(employee);
    expect(result.clientSubmittedBy).toEqual(client);
  });
});
