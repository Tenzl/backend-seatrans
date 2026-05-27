import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
