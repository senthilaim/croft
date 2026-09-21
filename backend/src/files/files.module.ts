import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BuildfarmConfigModule } from '../buildfarm-config/buildfarm-config.module.js';
import { DemoModule } from '../demo/demo.module.js';
import { ProvisioningModule } from '../provisioning/provisioning.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  imports: [AuthModule, BuildfarmConfigModule, DemoModule, ProvisioningModule, WorkspacesModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
