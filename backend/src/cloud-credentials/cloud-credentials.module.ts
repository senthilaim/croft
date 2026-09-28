import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { TokenCipherModule } from '../crypto/token-cipher.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { CloudCredentialsController } from './cloud-credentials.controller.js';
import { CloudCredentialsService } from './cloud-credentials.service.js';
import { CloudCredential, CloudCredentialSchema } from './schemas/cloud-credential.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CloudCredential.name, schema: CloudCredentialSchema }]),
    AuthModule,
    TokenCipherModule,
    WorkspacesModule,
  ],
  controllers: [CloudCredentialsController],
  providers: [CloudCredentialsService],
  exports: [CloudCredentialsService],
})
export class CloudCredentialsModule {}
