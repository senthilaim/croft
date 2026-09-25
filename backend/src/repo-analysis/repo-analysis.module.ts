import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { TokenCipherModule } from '../crypto/token-cipher.module.js';
import { ProvisioningModule } from '../provisioning/provisioning.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { CacheCheckService } from './cache-check.service.js';
import { RebuildSimulationService } from './rebuild-simulation.service.js';
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
    ProvisioningModule,
  ],
  controllers: [RepoAnalysisController],
  providers: [RepoConnectionService, RepoAnalysisService, RebuildSimulationService, CacheCheckService],
  exports: [RepoConnectionService],
})
export class RepoAnalysisModule {}
