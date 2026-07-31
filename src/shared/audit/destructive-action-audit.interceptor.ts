import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  catchError,
  concatMap,
  from,
  map,
  mergeMap,
  Observable,
  of,
  throwError,
} from 'rxjs';
import { AdminAuditService } from './admin-audit.service';

export const PERMANENT_DELETE_AUDIT_KEY =
  'permanent-delete-audit-specification';

export interface PermanentDeleteAuditSpec {
  resourceType: string;
  idSource?: { kind: 'param'; key: string } | { kind: 'query'; key: string };
  detailSources?: Array<{
    kind: 'body' | 'param' | 'query';
    key: string;
    label?: string;
  }>;
}

type AuditedRequest = {
  method?: string;
  originalUrl?: string;
  path?: string;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  user?: { id?: number };
};

@Injectable()
export class DestructiveActionAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DestructiveActionAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AdminAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const specification = this.reflector.get<PermanentDeleteAuditSpec>(
      PERMANENT_DELETE_AUDIT_KEY,
      context.getHandler(),
    );
    if (!specification) {
      throw new Error('Permanent delete audit metadata is missing');
    }

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const actorUserId = request.user?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Authenticated user is required');
    }

    const requestDetails = this.requestDetails(request, specification);
    return from(
      this.auditService.begin({
        actorUserId,
        ...(requestDetails ? { details: requestDetails } : {}),
        method: request.method ?? 'DELETE',
        requestPath: this.requestPath(request),
        resourceId: this.resourceId(request, specification),
        resourceType: specification.resourceType,
      }),
    ).pipe(
      mergeMap(({ id }) =>
        next.handle().pipe(
          concatMap((result: unknown) =>
            from(
              this.auditService.succeed(id, this.resultSummary(result)),
            ).pipe(
              map(() => result),
              catchError((auditError: unknown) => {
                this.logAuditUpdateFailure(id, auditError);
                return of(result);
              }),
            ),
          ),
          catchError((handlerError: unknown) =>
            from(
              this.auditService.fail(id, {
                errorType: this.errorType(handlerError),
              }),
            ).pipe(
              catchError((auditError: unknown) => {
                this.logAuditUpdateFailure(id, auditError);
                return of(undefined);
              }),
              mergeMap(() => throwError(() => handlerError)),
            ),
          ),
        ),
      ),
    );
  }

  private resourceId(
    request: AuditedRequest,
    specification: PermanentDeleteAuditSpec,
  ): string | null {
    const source = specification.idSource;
    if (!source) return null;
    const container = source.kind === 'param' ? request.params : request.query;
    const value = container?.[source.key];
    if (value == null) return null;
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'bigint'
    ) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized || null;
  }

  private requestPath(request: AuditedRequest): string {
    const path = request.originalUrl ?? request.path ?? '(unknown)';
    return path.split('?', 1)[0].slice(0, 500);
  }

  private requestDetails(
    request: AuditedRequest,
    specification: PermanentDeleteAuditSpec,
  ): Record<string, unknown> | null {
    const details: Record<string, unknown> = {};
    for (const source of specification.detailSources ?? []) {
      const container =
        source.kind === 'body'
          ? request.body
          : source.kind === 'param'
            ? request.params
            : request.query;
      const value = this.safeDetailValue(container?.[source.key]);
      if (value !== undefined) {
        details[source.label ?? source.key] = value;
      }
    }
    return Object.keys(details).length ? details : null;
  }

  private safeDetailValue(
    value: unknown,
  ): string | number | boolean | Array<string | number | boolean> | undefined {
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    ) {
      return typeof value === 'string' ? value.slice(0, 500) : value;
    }
    if (!Array.isArray(value)) return undefined;

    const primitives = value.filter(
      (entry): entry is string | number | boolean =>
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean',
    );
    return primitives
      .slice(0, 500)
      .map((entry) =>
        typeof entry === 'string' ? entry.slice(0, 500) : entry,
      );
  }

  private resultSummary(result: unknown): Record<string, unknown> | null {
    if (typeof result !== 'object' || result === null) return null;
    const record = result as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    if (typeof record.deleted === 'number') {
      summary.deleted = record.deleted;
    }
    if (typeof record.deletedCount === 'number') {
      summary.deletedCount = record.deletedCount;
    }
    return Object.keys(summary).length ? summary : null;
  }

  private errorType(error: unknown): string {
    if (error instanceof Error && error.constructor.name) {
      return error.constructor.name;
    }
    return 'UnknownError';
  }

  private logAuditUpdateFailure(id: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Failed to finalize admin audit log ${id}: ${message}`);
  }
}
