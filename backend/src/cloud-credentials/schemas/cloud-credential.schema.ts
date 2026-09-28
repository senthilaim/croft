import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { CloudEnvironment, CloudProvider } from '@croft/shared-types';

export type CloudCredentialDocument = HydratedDocument<CloudCredential>;

/**
 * One AWS connection per workspace per environment (v1: only 'staging' is ever written, see
 * CloudCredentialsService.connect()). Unique on {workspaceId, provider, environment} rather than
 * just {workspaceId, provider} -- deliberately leaves room for a later production credential
 * alongside staging.
 */
@Schema({ timestamps: true })
export class CloudCredential {
  @Prop({ required: true })
  workspaceId!: string;

  @Prop({ type: String, required: true, enum: ['aws'] })
  provider!: CloudProvider;

  @Prop({ type: String, required: true, enum: ['staging', 'production'] })
  environment!: CloudEnvironment;

  @Prop({ required: true })
  roleArn!: string;

  // Deterministic (TokenCipherService.deriveExternalId), not stored as a secret -- kept here
  // anyway so toDto() and every read path have one source of truth without re-deriving it.
  @Prop({ required: true })
  externalId!: string;

  @Prop({ required: true })
  bootstrapAccessKeyId!: string;

  // AES-256-GCM ciphertext of the bootstrap secret key, plus its IV and auth tag -- see
  // TokenCipherService. Never exposed outside this schema; toDto() omits all three fields.
  @Prop({ required: true })
  bootstrapSecretCiphertext!: string;

  @Prop({ required: true })
  bootstrapSecretIv!: string;

  @Prop({ required: true })
  bootstrapSecretAuthTag!: string;

  @Prop({ required: true })
  bootstrapKeyLast4!: string;

  @Prop({ required: true })
  region!: string;

  @Prop({ required: true })
  idleTimeoutMinutes!: number;

  @Prop({ type: [String], required: true })
  allowedIngressCidrs!: string[];

  @Prop({ required: true })
  connectedBy!: string;
}

export const CloudCredentialSchema = SchemaFactory.createForClass(CloudCredential);
CloudCredentialSchema.index({ workspaceId: 1, provider: 1, environment: 1 }, { unique: true });
