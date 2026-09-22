import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { TokenCipherModule } from '../crypto/token-cipher.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { RepoAnalysisController } from './repo-analysis.controller.js';
import { RepoAnalysisService } from './repo-analysis.service.js';
import { RepoConnection, RepoConnectionSchema } from './schemas/repo-connection.schema.js';
import { RepoConnectionService } from './repo-connection.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RepoConnection.name, schema: RepoConnectionSchema }]),
    AuthModule,
    TokenCipherModule,
    WorkspacesModule,
  ],
  controllers: [RepoAnalysisController],
  providers: [RepoConnectionService, RepoAnalysisService],
  exports: [RepoConnectionService],
})
export class RepoAnalysisModule {}
