import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { WorkspaceRole } from '@croft/shared-types';
import type { WorkspaceScopedRequest } from './workspace-membership.guard.js';

export const CurrentWorkspaceRole = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceRole => {
    const request = ctx.switchToHttp().getRequest<WorkspaceScopedRequest>();
    return request.workspaceRole;
  },
);
