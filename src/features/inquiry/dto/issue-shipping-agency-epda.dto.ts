import { IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ConfirmedCustomerFieldChangeDto } from './confirmed-customer-field-change.dto';

/**
 * Finalize EPDA for customer: persist snapshot and mark inquiry QUOTED.
 */
export class IssueShippingAgencyEpdaDto {
  @IsObject()
  epdaSnapshot!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;

  /** Staff-confirmed overrides of customer-submitted values (audit log). */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedCustomerFieldChangeDto)
  confirmedCustomerFieldChanges?: ConfirmedCustomerFieldChangeDto[];
}
