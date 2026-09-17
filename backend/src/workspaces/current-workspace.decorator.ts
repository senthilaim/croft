import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { WorkspaceScopedRequest } from './workspace-membership.guard.js';
import type { WorkspaceDocument } from './schemas/workspace.schema.js';

export const CurrentWorkspace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceDocument => {
    const request = ctx.switchToHttp().getRequest<WorkspaceScopedRequest>();
    return request.workspace;
  },
);
