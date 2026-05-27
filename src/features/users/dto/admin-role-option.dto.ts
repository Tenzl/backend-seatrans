import { RoleGroup } from '../../auth/enums/role-group.enum';

export class AdminRoleOptionDto {
  id!: number;
  name!: string;
  roleGroup!: RoleGroup;
  label!: string;

  static from(role: { id: number; name: string; roleGroup: RoleGroup; description?: string | null }) {
    const dto = new AdminRoleOptionDto();
    dto.id = role.id;
    dto.name = role.name;
    dto.roleGroup = role.roleGroup;
    dto.label = role.description?.trim() ? `${role.name} — ${role.description}` : role.name;
    return dto;
  }
}

