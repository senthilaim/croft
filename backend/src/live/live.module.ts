import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BuildsModule } from '../builds/builds.module.js';
import { ProvisioningModule } from '../provisioning/provisioning.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { LiveGateway } from './live.gateway.js';

@Module({
  imports: [AuthModule, BuildsModule, ProvisioningModule, WorkspacesModule],
  providers: [LiveGateway],
})
export class LiveModule {}
