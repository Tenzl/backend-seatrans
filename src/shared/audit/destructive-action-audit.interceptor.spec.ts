import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AdminAuditService, BeginAdminAuditInput } from './admin-audit.service';
import {
  DestructiveActionAuditInterceptor,
  PERMANENT_DELETE_AUDIT_KEY,
} from './destructive-action-audit.interceptor';

describe('DestructiveActionAuditInterceptor', () => {
  function setup(options?: { beginError?: Error }) {
    const auditService = {
      begin: options?.beginError
        ? jest.fn().mockRejectedValue(options.beginError)
        : jest.fn().mockResolvedValue({ id: 91 }),
      succeed: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const reflector = {
      get: jest.fn().mockReturnValue({
        resourceType: 'booking_partner',
        idSource: { kind: 'param', key: 'id' },
      }),
    };
    const interceptor = new DestructiveActionAuditInterceptor(
      reflector as unknown as Reflector,
      auditService as unknown as AdminAuditService,
    );
    const request = {
      method: 'DELETE',
      route: { path: '/v1/admin/partners/:id' },
      originalUrl: '/api/v1/admin/partners/44',
      params: { id: '44' },
      query: {},
      user: { id: 7 },
    };
    const context = {
      getHandler: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { auditService, context, interceptor, reflector };
  }

  it('writes STARTED before the handler and marks a successful delete', async () => {
    const { auditService, context, interceptor } = setup();
    const order: string[] = [];
    auditService.begin.mockImplementation(() => {
      order.push('audit-started');
      return Promise.resolve({ id: 91 });
    });
    auditService.succeed.mockImplementation(() => {
      order.push('audit-succeeded');
      return Promise.resolve();
    });
    const next = {
      handle: jest.fn(() => {
        order.push('delete-handler');
        return of({ deleted: 1 });
      }),
    } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({ deleted: 1 });
    expect(order).toEqual([
      'audit-started',
      'delete-handler',
      'audit-succeeded',
    ]);
    expect(auditService.begin).toHaveBeenCalledWith({
      actorUserId: 7,
      method: 'DELETE',
      requestPath: '/api/v1/admin/partners/44',
      resourceId: '44',
      resourceType: 'booking_partner',
    });
    expect(auditService.succeed).toHaveBeenCalledWith(91, {
      deleted: 1,
    });
  });

  it('blocks the destructive handler when the initial audit write fails', async () => {
    const { context, interceptor } = setup({
      beginError: new Error('audit unavailable'),
    });
    const handle = jest.fn(() => of(undefined));
    const next = { handle } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('audit unavailable');
    expect(handle).not.toHaveBeenCalled();
  });

  it('marks a failed attempt and preserves the original handler error', async () => {
    const { auditService, context, interceptor } = setup();
    const handlerError = new Error('partner is referenced');
    const next = {
      handle: jest.fn(() => throwError(() => handlerError)),
    } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBe(handlerError);
    expect(auditService.fail).toHaveBeenCalledWith(91, {
      errorType: 'Error',
    });
  });

  it('uses the permanent-delete metadata key', () => {
    expect(PERMANENT_DELETE_AUDIT_KEY).toBe(
      'permanent-delete-audit-specification',
    );
  });

  it('captures only explicitly configured request fields for batch audit', async () => {
    const { auditService, context, interceptor, reflector } = setup();
    reflector.get.mockReturnValue({
      resourceType: 'inquiry_batch',
      detailSources: [
        { kind: 'body', key: 'ids', label: 'resourceIds' },
        { kind: 'query', key: 'serviceSlug' },
      ],
    });
    const request = context.switchToHttp().getRequest<{
      body: Record<string, unknown>;
      query: Record<string, unknown>;
    }>();
    request.body = { ids: [11, 12], secret: 'do-not-log' };
    request.query = { serviceSlug: 'shipping-agency' };
    const next = { handle: jest.fn(() => of(undefined)) } as CallHandler;

    await lastValueFrom(interceptor.intercept(context, next));

    expect(auditService.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          resourceIds: [11, 12],
          serviceSlug: 'shipping-agency',
        },
      }),
    );
    const beginCalls = auditService.begin.mock.calls as unknown as Array<
      [BeginAdminAuditInput]
    >;
    expect(beginCalls[0]?.[0].details).not.toHaveProperty('secret');
  });
});
