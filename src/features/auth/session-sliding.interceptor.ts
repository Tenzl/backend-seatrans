import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { setAuthCookie } from './auth-cookie';
import type { SessionJwtClaims } from './session-policy';
import type { User } from './entities/user.entity';

type AuthedRequest = Request & {
  user?: User;
  sessionJwt?: SessionJwtClaims;
};

/**
 * After a successful authenticated handler, re-issue the cookie JWT when it is
 * close to idle expiry (sliding), without extending past absolute auth_time.
 */
@Injectable()
export class SessionSlidingInterceptor implements NestInterceptor {
  constructor(private readonly authService: AuthService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        if (!req.user || !req.sessionJwt || res.headersSent) return;
        const refreshed = this.authService.maybeSlideSession(
          req.user,
          req.sessionJwt,
        );
        if (!refreshed) return;
        setAuthCookie(res, refreshed.token, refreshed.cookieMaxAgeMs);
      }),
    );
  }
}
