/**
 * Lean row for booking Person In Charge pickers.
 * Omits password and unused profile fields from AdminUserRowDto.
 */
export class AdminPicOptionDto {
  id!: number;
  email!: string;
  companyEmail!: string | null;
  fullName!: string | null;
  roleName!: string | null;

  static from(row: {
    id: number;
    email: string;
    companyEmail?: string | null;
    fullName?: string | null;
    roleName?: string | null;
  }): AdminPicOptionDto {
    const dto = new AdminPicOptionDto();
    dto.id = row.id;
    dto.email = row.email;
    dto.companyEmail = row.companyEmail ?? null;
    dto.fullName = row.fullName ?? null;
    dto.roleName = row.roleName ?? null;
    return dto;
  }
}
