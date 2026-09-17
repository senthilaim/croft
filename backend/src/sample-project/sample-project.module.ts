import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { ProvisioningModule } from '../provisioning/provisioning.module.js';
import { BuildfarmConfigModule } from '../buildfarm-config/buildfarm-config.module.js';
import { SampleProjectController } from './sample-project.controller.js';
import { SampleProjectService } from './sample-project.service.js';

@Module({
  imports: [AuthModule, WorkspacesModule, ProvisioningModule, BuildfarmConfigModule],
  controllers: [SampleProjectController],
  providers: [SampleProjectService],
})
export class SampleProjectModule {}
