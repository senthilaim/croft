import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { Build, BuildSchema } from './schemas/build.schema.js';
import { TestRun, TestRunSchema } from './schemas/test-run.schema.js';
import { BuildsController, BuildsIngestController, TestRunsController } from './builds.controller.js';
import { BuildsService } from './builds.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Build.name, schema: BuildSchema },
      { name: TestRun.name, schema: TestRunSchema },
    ]),
    AuthModule,
    WorkspacesModule,
  ],
  controllers: [BuildsIngestController, BuildsController, TestRunsController],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
