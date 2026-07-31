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
    [AdminInquiryController, 'hardDeleteBatch', 'inquiry_batch'],
    [AdminInquiryController, 'hardRemove', 'inquiry'],
    [EpdaParametersAdminController, 'deletePort', 'epda_port_override'],
    [EpdaParametersAdminController, 'deleteGroup', 'epda_parameter_group'],
    [CategoriesAdminController, 'remove', 'post_category'],
    [CommoditiesAdminController, 'remove', 'commodity'],
    [GalleryAdminController, 'remove', 'gallery_image'],
    [OfficesAdminController, 'remove', 'office'],
    [PortsAdminController, 'deletePort', 'port'],
    [PostsAdminController, 'remove', 'post'],
    [ProvincesAdminController, 'deleteProvince', 'province'],
    [RolesAdminController, 'remove', 'role'],
    [ServiceTypesController, 'remove', 'service_type'],
    [StorageAdminController, 'remove', 'storage_object'],
  ] as const;

  it.each([AdminUsersController, RolesAdminController])(
    'requires the exact ROLE_ADMIN role on %p',
    (controller) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([
        'ROLE_ADMIN',
      ]);
    },
  );

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

  it.each(permanentDeletes)(
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

  it('reserves booking-document unlock for ROLE_ADMIN', () => {
    const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      BookingDocumentsAdminController.prototype.unlockRecord,
      BookingDocumentsAdminController,
    ]);
    expect(roles).toEqual(['ROLE_ADMIN']);
  });
});
