import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceMembershipGuard } from './workspace-membership.guard.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Workspace.name, schema: WorkspaceSchema }]),
    AuthModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceMembershipGuard],
  exports: [WorkspacesService, WorkspaceMembershipGuard],
})
export class WorkspacesModule {}
