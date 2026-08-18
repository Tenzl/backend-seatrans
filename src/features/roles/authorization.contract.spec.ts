import 'reflect-metadata';

jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: (html: string) => html,
}));

import { Reflector } from '@nestjs/core';
import {
  PERMANENT_DELETE_AUDIT_KEY,
  PermanentDeleteAuditSpec,
} from '../../shared/audit/destructive-action-audit.interceptor';
import { AdminBookingPartnerController } from '../booking/controllers/admin-booking-partner.controller';
import { BookingDocumentsAdminController } from '../booking-documents/booking-documents-admin.controller';
import { CommoditiesAdminController } from '../commodities/commodities-admin.controller';
import { GalleryAdminController } from '../gallery/gallery-admin.controller';
import { EpdaParametersAdminController } from '../epda-parameters/epda-parameters-admin.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RoleGroup } from '../auth/enums/role-group.enum';
import { SECTION_KEY } from './decorators/section.decorator';
import { AdminInquiryDocumentController } from '../inquiry/controllers/admin-inquiry-document.controller';
import { AdminInquiryController } from '../inquiry/controllers/admin-inquiry.controller';
import { OfficesAdminController } from '../logistics/offices-admin.controller';
import { ServiceTypesController } from '../logistics/service-types.controller';
import { PortsAdminController } from '../ports/ports-admin.controller';
import { CategoriesAdminController } from '../post/categories-admin.controller';
import { PostsAdminController } from '../post/posts-admin.controller';
import { ProvincesAdminController } from '../provinces/provinces-admin.controller';
import { StorageAdminController } from '../storage/storage-admin.controller';
import { AdminUsersController } from '../users/controllers/admin-users.controller';
import { RolesAdminController } from './roles-admin.controller';
import { isAdminRoleName } from './section-access.service';

describe('privileged authorization contract', () => {
  const reflector = new Reflector();
  const permanentDeletes = [
    [AdminBookingPartnerController, 'removeAllPartners', 'booking_partner_all'],
    [AdminBookingPartnerController, 'removePartner', 'booking_partner'],
    [AdminInquiryDocumentController, 'deleteDocument', 'inquiry_document'],
    [EpdaParametersAdminController, 'deletePort', 'epda_port_override'],
    [EpdaParametersAdminController, 'deleteGroup', 'epda_parameter_group'],
    [CategoriesAdminController, 'remove', 'post_category'],
    [GalleryAdminController, 'remove', 'gallery_image'],
    [OfficesAdminController, 'remove', 'office'],
    [PortsAdminController, 'deletePort', 'port'],
    [PostsAdminController, 'remove', 'post'],
    [ProvincesAdminController, 'deleteProvince', 'province'],
    [RolesAdminController, 'remove', 'role'],
    [ServiceTypesController, 'remove', 'service_type'],
    [StorageAdminController, 'remove', 'storage_object'],
  ] as const;

  /** Permanent deletes any internal staff holding the section may perform. */
  const sectionPermanentDeletes = [
    [CommoditiesAdminController, 'remove', 'commodity', 'data-commodities'],
    [
      BookingDocumentsAdminController,
      'deleteRecord',
      'booking_document_record',
      'booking-documents',
    ],
    [AdminInquiryController, 'deleteBatch', 'inquiry_batch', 'epda-inquiry'],
    [AdminInquiryController, 'remove', 'inquiry', 'epda-inquiry'],
  ] as const;

  it('requires the exact ROLE_ADMIN role on RolesAdminController', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RolesAdminController)).toEqual([
      'ROLE_ADMIN',
    ]);
  });

  it.each([
    'list',
    'roles',
    'create',
    'updateRole',
    'resetPassword',
    'remove',
    'reactivate',
  ] as const)(
    'reserves AdminUsersController.%s for ROLE_ADMIN',
    (methodName) => {
      const prototype = AdminUsersController.prototype as unknown as Record<
        string,
        object
      >;
      const handler = prototype[methodName];
      expect(
        reflector.getAllAndOverride<string[]>(ROLES_KEY, [
          handler,
          AdminUsersController,
        ]),
      ).toEqual(['ROLE_ADMIN']);
    },
  );

  it('gates AdminUsersController.listPicOptions behind booking-documents section', () => {
    const prototype = AdminUsersController.prototype as unknown as Record<
      string,
      object
    >;
    expect(
      reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        prototype.listPicOptions,
        AdminUsersController,
      ]),
    ).toEqual([RoleGroup.INTERNAL]);
    expect(
      reflector.getAllAndOverride<string[]>(SECTION_KEY, [
        prototype.listPicOptions,
        AdminUsersController,
      ]),
    ).toEqual(['booking-documents']);
  });

  it.each([
    'ROLE_ADMIN_ASSISTANT',
    'SUPER_ADMIN',
    'ADMINISTRATOR',
    'ROLE_EMPLOYEE',
    '',
    null,
    undefined,
  ])('does not treat %p as the reserved admin role', (roleName) => {
    expect(isAdminRoleName(roleName)).toBe(false);
  });

  it.each(['ROLE_ADMIN', 'ADMIN', ' role_admin '])(
    'recognizes the canonical admin role %p',
    (roleName) => {
      expect(isAdminRoleName(roleName)).toBe(true);
    },
  );

  it.each(permanentDeletes)(
    'reserves permanent delete %p.%s for ROLE_ADMIN',
    (controller, methodName) => {
      const prototype = controller.prototype as unknown as Record<
        string,
        object
      >;
      const handler = prototype[methodName];
      const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        handler,
        controller,
      ]);
      expect(roles).toEqual(['ROLE_ADMIN']);
    },
  );

  it.each([
    ...permanentDeletes.map(
      ([controller, methodName, resourceType]) =>
        [controller, methodName, resourceType] as const,
    ),
    ...sectionPermanentDeletes.map(
      ([controller, methodName, resourceType]) =>
        [controller, methodName, resourceType] as const,
    ),
  ])(
    'audits permanent delete %p.%s as %s',
    (controller, methodName, resourceType) => {
      const prototype = controller.prototype as unknown as Record<
        string,
        object
      >;
      const handler = prototype[methodName];
      const audit = reflector.get<PermanentDeleteAuditSpec>(
        PERMANENT_DELETE_AUDIT_KEY,
        handler,
      );
      expect(audit).toMatchObject({ resourceType });
    },
  );

  it.each(sectionPermanentDeletes)(
    'gates permanent delete %p.%s (%s) behind internal staff holding %s',
    (controller, methodName, _resourceType, section) => {
      const prototype = controller.prototype as unknown as Record<
        string,
        object
      >;
      const handler = prototype[methodName];
      expect(
        reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, controller]),
      ).toEqual([RoleGroup.INTERNAL]);
      expect(
        reflector.getAllAndOverride<string[]>(SECTION_KEY, [
          handler,
          controller,
        ]),
      ).toEqual([section]);
    },
  );

  it('reserves booking-document unlock for ROLE_ADMIN', () => {
    const prototype =
      BookingDocumentsAdminController.prototype as unknown as Record<
        string,
        object
      >;
    const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      prototype.unlockRecord,
      BookingDocumentsAdminController,
    ]);
    expect(roles).toEqual(['ROLE_ADMIN']);
  });

  it('reserves EPDA unlock for ROLE_ADMIN', () => {
    const prototype = AdminInquiryController.prototype as unknown as Record<
      string,
      object
    >;
    const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      prototype.unlockShippingAgencyEpda,
      AdminInquiryController,
    ]);
    expect(roles).toEqual(['ROLE_ADMIN']);
  });

  it.each([
    [AdminInquiryController, 'list'],
    [AdminInquiryController, 'getOne'],
    [AdminInquiryController, 'updateStatus'],
    [AdminInquiryController, 'updateForm'],
    [AdminInquiryController, 'createShippingAgencyWithEpda'],
    [AdminInquiryDocumentController, 'uploadDocument'],
  ] as const)(
    'gates inquiry admin %p.%s behind INTERNAL + epda-inquiry',
    (controller, methodName) => {
      const prototype = controller.prototype as unknown as Record<
        string,
        object
      >;
      const handler = prototype[methodName];
      expect(
        reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, controller]),
      ).toEqual([RoleGroup.INTERNAL]);
      expect(
        reflector.getAllAndOverride<string[]>(SECTION_KEY, [
          handler,
          controller,
        ]),
      ).toEqual(['epda-inquiry']);
    },
  );

  it('keeps inquiry-document permanent delete on ROLE_ADMIN', () => {
    const prototype =
      AdminInquiryDocumentController.prototype as unknown as Record<
        string,
        object
      >;
    expect(
      reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        prototype.deleteDocument,
        AdminInquiryDocumentController,
      ]),
    ).toEqual(['ROLE_ADMIN']);
  });
});
