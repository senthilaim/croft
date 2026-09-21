import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { Build, BuildSchema } from '../builds/schemas/build.schema.js';
import { TestRun, TestRunSchema } from '../builds/schemas/test-run.schema.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Build.name, schema: BuildSchema },
      { name: TestRun.name, schema: TestRunSchema },
    ]),
    AuthModule,
    WorkspacesModule,
  ],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
