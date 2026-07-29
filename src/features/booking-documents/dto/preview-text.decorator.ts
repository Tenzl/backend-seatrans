import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Optional bounded text accepted by the manual document forms. */
export function PreviewText(maxLength = 2_000): PropertyDecorator {
  return applyDecorators(IsOptional(), IsString(), MaxLength(maxLength));
}
