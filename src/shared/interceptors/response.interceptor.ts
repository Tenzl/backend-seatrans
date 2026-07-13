import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response';

/**
 * Standardize ALL successful responses to the { success, message, data } envelope structure.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor<
  unknown,
  ApiResponse<unknown>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<ApiResponse<unknown>> {
    return next.handle().pipe(
      map((data: unknown): ApiResponse<unknown> => {
        // Skip wrapping if the handler already returned an ApiResponse wrapper manually
        if (data instanceof ApiResponse) {
          return data;
        }
        return ApiResponse.success(data);
      }),
    );
  }
}
