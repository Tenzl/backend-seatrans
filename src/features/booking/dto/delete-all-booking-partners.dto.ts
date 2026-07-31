import { Equals, IsInt, Min } from 'class-validator';

export const DELETE_ALL_PARTNERS_CONFIRMATION = 'DELETE ALL PARTNERS';

export class DeleteAllBookingPartnersDto {
  @Equals(DELETE_ALL_PARTNERS_CONFIRMATION)
  confirmation!: string;

  @IsInt()
  @Min(0)
  expectedCount!: number;
}
