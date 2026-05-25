import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response';

/**
 * Standardize ALL successful responses to the { success, message, data } envelope structure.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map(data => {
        // Skip wrapping if the handler already returned an ApiResponse wrapper manually
        if (data instanceof ApiResponse) {
          return data;
        }
        return ApiResponse.success(data);
      }),
    );
  }
}
