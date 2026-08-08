import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import {
  DestructiveActionAuditInterceptor,
  PERMANENT_DELETE_AUDIT_KEY,
  PermanentDeleteAuditSpec,
} from '../audit/destructive-action-audit.interceptor';
import { AdminSection } from './admin-section.decorator';
import { ApiAdminOnly } from './api-admin.decorator';

/**
 * Single policy for irreversible API deletes: exact ROLE_ADMIN authorization
 * plus a durable audit attempt written before the handler can run.
 */
export function PermanentDelete(specification: PermanentDeleteAuditSpec) {
  return applyDecorators(
    ApiAdminOnly(),
    SetMetadata(PERMANENT_DELETE_AUDIT_KEY, specification),
    UseInterceptors(DestructiveActionAuditInterceptor),
  );
}

/**
 * Irreversible delete for catalog data that the whole section may maintain:
 * same durable audit as PermanentDelete, but authorized like the section's
 * other endpoints (internal staff holding `section`) instead of ROLE_ADMIN.
 */
export function SectionPermanentDelete(
  section: string,
  specification: PermanentDeleteAuditSpec,
) {
  return applyDecorators(
    AdminSection(section),
    SetMetadata(PERMANENT_DELETE_AUDIT_KEY, specification),
    UseInterceptors(DestructiveActionAuditInterceptor),
  );
}
