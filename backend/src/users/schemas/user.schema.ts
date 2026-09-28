import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  // Absent for an OIDC-only account (never set a password). AuthService.signin() guards this
  // before bcrypt.compare() so that case still rejects with the same generic "Invalid email or
  // password" message as any other signin failure, rather than throwing a TypeError.
  @Prop({ required: false })
  passwordHash?: string;

  @Prop({ required: true, trim: true })
  name!: string;

  // Absent on every account created before OIDC existed -- treated as 'password' implicitly.
  // New accounts set this explicitly at creation (see UsersService.create/createFromOidc).
  @Prop({ type: String, enum: ['password', 'oidc'] })
  authProvider?: 'password' | 'oidc';

  // The IdP's stable subject claim for an OIDC-linked account. Audit/debugging aid only -- not
  // used for lookup (account resolution is by email, to keep workspace invites, which are
  // email-keyed, working for either sign-in method under the same account).
  @Prop({ required: false })
  oidcSubject?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
