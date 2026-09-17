import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { WorkspacesService } from './workspaces.service.js';
import type { WorkspaceDocument } from './schemas/workspace.schema.js';

export interface WorkspaceScopedRequest extends AuthenticatedRequest {
  workspace: WorkspaceDocument;
}

@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(private readonly workspacesService: WorkspacesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceScopedRequest>();
    const workspaceId = request.params.id as string;

    const workspace = await this.workspacesService.findById(workspaceId);
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (!this.workspacesService.isMember(workspace, request.userId)) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    request.workspace = workspace;
    return true;
  }
}
