import { RoleGroup } from '../../auth/enums/role-group.enum';

export class AdminUserRowDto {
  id!: number;
  email!: string;
  username!: string | null;
  fullName!: string | null;
  phone!: string | null;
  company!: string | null;
  isActive!: boolean;
  roleId!: number | null;
  roleName!: string | null;
  roleGroup!: RoleGroup | null;
  createdAt!: Date;

  static from(row: {
    id: number;
    email: string;
    username?: string | null;
    fullName: string | null;
    phone: string | null;
    company: string | null;
    isActive: boolean;
    createdAt: Date;
    role?: { id: number; name: string; roleGroup: RoleGroup } | null;
  }): AdminUserRowDto {
    const dto = new AdminUserRowDto();
    dto.id = row.id;
    dto.email = row.email;
    dto.username = row.username ?? null;
    dto.fullName = row.fullName ?? null;
    dto.phone = row.phone ?? null;
    dto.company = row.company ?? null;
    dto.isActive = row.isActive;
    dto.createdAt = row.createdAt;
    dto.roleId = row.role?.id ?? null;
    dto.roleName = row.role?.name ?? null;
    dto.roleGroup = row.role?.roleGroup ?? null;
    return dto;
  }
}

