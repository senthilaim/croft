import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { BuildfarmConfig, BuildfarmConfigSchema } from './schemas/buildfarm-config.schema.js';
import { BuildfarmConfigController } from './buildfarm-config.controller.js';
import { BuildfarmConfigService } from './buildfarm-config.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: BuildfarmConfig.name, schema: BuildfarmConfigSchema }]),
    AuthModule,
    WorkspacesModule,
  ],
  controllers: [BuildfarmConfigController],
  providers: [BuildfarmConfigService],
  exports: [BuildfarmConfigService],
})
export class BuildfarmConfigModule {}
