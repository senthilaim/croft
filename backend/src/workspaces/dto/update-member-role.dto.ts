import { IsIn } from 'class-validator';
import type { UpdateMemberRoleRequest, WorkspaceRole } from '@croft/shared-types';

const ASSIGNABLE_ROLES: Exclude<WorkspaceRole, 'owner'>[] = ['admin', 'member', 'viewer'];

export class UpdateMemberRoleDto implements UpdateMemberRoleRequest {
  @IsIn(ASSIGNABLE_ROLES)
  role!: Exclude<WorkspaceRole, 'owner'>;
}
