import { IsObject } from 'class-validator';

/**
 * Lock EPDA for further staff edits: persist tariff snapshot and set epdaLockedAt.
 */
export class LockShippingAgencyEpdaDto {
  @IsObject()
  epdaSnapshot!: Record<string, unknown>;
}
