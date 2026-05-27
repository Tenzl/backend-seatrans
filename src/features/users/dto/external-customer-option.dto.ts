export class ExternalCustomerOptionDto {
  id!: number;
  fullName!: string;
  email!: string;
  company!: string | null;
  label!: string;

  static from(user: {
    id: number;
    fullName: string | null;
    email: string;
    company: string | null;
  }): ExternalCustomerOptionDto {
    const fullName = user.fullName?.trim() || 'Unnamed customer';
    const dto = new ExternalCustomerOptionDto();
    dto.id = user.id;
    dto.fullName = fullName;
    // External customer emails may be placeholder-only (for DB uniqueness).
    // Do not expose them to the admin EPDA UI; keep email blank.
    dto.email = '';
    dto.company = user.company;
    dto.label = user.company ? `${fullName} — ${user.company}` : fullName;
    return dto;
  }
}
