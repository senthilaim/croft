import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { BuildfarmConfigModule } from './buildfarm-config/buildfarm-config.module.js';
import { ProvisioningModule } from './provisioning/provisioning.module.js';
import { SampleProjectModule } from './sample-project/sample-project.module.js';
import { BuildsModule } from './builds/builds.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/croft'),
      }),
    }),
    HealthModule,
    AuthModule,
    WorkspacesModule,
    BuildfarmConfigModule,
    ProvisioningModule,
    SampleProjectModule,
    BuildsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
