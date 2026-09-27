import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Type, mixin } from '@nestjs/common';
import type { WorkspaceRole } from '@croft/shared-types';
import type { WorkspaceScopedRequest } from './workspace-membership.guard.js';

/**
 * Parameterized guard factory -- `@UseGuards(WorkspaceMembershipGuard, WorkspaceRoleGuard('owner',
 * 'admin'))`. Must run after `WorkspaceMembershipGuard` (reads `request.workspaceRole`, which that
 * guard sets; it does not look the role up itself). This codebase has no `Reflector`/`SetMetadata`
 * precedent anywhere, so this follows the existing convention (a guard, not a metadata decorator)
 * while still letting the allowed-roles list vary per route, via Nest's `mixin()` helper -- each
 * call returns its own throwaway `@Injectable()` class, not a shared singleton.
 */
export function WorkspaceRoleGuard(...allowedRoles: WorkspaceRole[]): Type<CanActivate> {
  @Injectable()
  class RoleGuardMixin implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest<WorkspaceScopedRequest>();
      if (!allowedRoles.includes(request.workspaceRole)) {
        throw new ForbiddenException(`Requires one of these roles: ${allowedRoles.join(', ')}`);
      }
      return true;
    }
  }
  return mixin(RoleGuardMixin);
}
