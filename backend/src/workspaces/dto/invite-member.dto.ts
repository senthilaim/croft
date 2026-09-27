import { IsEmail, IsIn } from 'class-validator';
import type { InviteMemberRequest, WorkspaceRole } from '@croft/shared-types';

const INVITABLE_ROLES: Exclude<WorkspaceRole, 'owner'>[] = ['admin', 'member', 'viewer'];

export class InviteMemberDto implements InviteMemberRequest {
  @IsEmail()
  email!: string;

  @IsIn(INVITABLE_ROLES)
  role!: Exclude<WorkspaceRole, 'owner'>;
}
