import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { BuildfarmConfigModule } from '../buildfarm-config/buildfarm-config.module.js';
import { BuildsModule } from '../builds/builds.module.js';
import { CloudCredentialsModule } from '../cloud-credentials/cloud-credentials.module.js';
import { IdleTimeoutService } from './idle-timeout.service.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningService } from './provisioning.service.js';

@Module({
  imports: [AuthModule, WorkspacesModule, BuildfarmConfigModule, CloudCredentialsModule, BuildsModule],
  controllers: [ProvisioningController],
  providers: [ProvisioningService, IdleTimeoutService],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
