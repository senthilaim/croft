import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BuildfarmConfigModule } from '../buildfarm-config/buildfarm-config.module.js';
import { BuildsModule } from '../builds/builds.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { CostController } from './cost.controller.js';

@Module({
  imports: [AuthModule, BuildfarmConfigModule, BuildsModule, WorkspacesModule],
  controllers: [CostController],
})
export class CostModule {}
