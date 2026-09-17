import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { Build, BuildSchema } from './schemas/build.schema.js';
import { BuildsController, BuildsIngestController } from './builds.controller.js';
import { BuildsService } from './builds.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Build.name, schema: BuildSchema }]),
    AuthModule,
    WorkspacesModule,
  ],
  controllers: [BuildsIngestController, BuildsController],
  providers: [BuildsService],
})
export class BuildsModule {}
