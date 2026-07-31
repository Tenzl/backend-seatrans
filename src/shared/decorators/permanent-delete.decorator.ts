import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import {
  DestructiveActionAuditInterceptor,
  PERMANENT_DELETE_AUDIT_KEY,
  PermanentDeleteAuditSpec,
} from '../audit/destructive-action-audit.interceptor';
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
