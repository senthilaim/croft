import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceMembershipGuard } from './workspace-membership.guard.js';

// WorkspaceRoleGuard (workspace-role.guard.js) is a factory -- each call returns its own
// @Injectable() class via Nest's mixin() helper, resolved through DI at the point of use in
// @UseGuards(...), not a singleton that needs registering here.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Workspace.name, schema: WorkspaceSchema }]),
    AuthModule,
    UsersModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceMembershipGuard],
  exports: [WorkspacesService, WorkspaceMembershipGuard],
})
export class WorkspacesModule {}
