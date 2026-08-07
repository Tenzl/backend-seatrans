import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * One custom fee line under agency "in lumpsum" mode.
 * Persisted in `agency_other_expenses` JSONB on the inquiry row.
 */
export class AgencyOtherExpenseDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;
}

/** Canonical stored / API item after service normalization. */
export type AgencyOtherExpense = {
  name: string;
  amount: number;
};
