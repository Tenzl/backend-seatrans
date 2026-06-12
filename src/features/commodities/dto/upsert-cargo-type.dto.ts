import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** Create a cargo type. The composite key is (serviceTypeId -> service_type_type, code). */
export class CreateCargoTypeDto {
  @IsInt()
  serviceTypeId!: number;

  @IsString()
  @MaxLength(100)
  code!: string;

  @IsString()
  @MaxLength(120)
  displayLabel!: string;
}

/** Update a cargo type's label (identifier comes from the path). */
export class UpdateCargoTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayLabel?: string;
}
