import { IsIn, IsInt } from 'class-validator';

export class UpdatePortHasInfoDto {
  @IsInt()
  @IsIn([0, 1])
  hasInfo: number;
}
