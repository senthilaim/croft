import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { User as UserDto } from '@croft/shared-types';
import { User, UserDocument } from './schemas/user.schema.js';

function toPublicUser(user: UserDocument): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: (user as UserDocument & { createdAt: Date }).createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(email: string, passwordHash: string, name: string): Promise<UserDocument> {
    try {
      return await this.userModel.create({ email, passwordHash, name });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 11000) {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  /** Safe for handing to a caller outside the account's own session (e.g. a workspace-invite
   * lookup) -- never includes passwordHash, unlike the raw findByEmail/findById above. */
  async findPublicByEmail(email: string): Promise<UserDto | null> {
    const user = await this.findByEmail(email);
    return user ? toPublicUser(user) : null;
  }

  async findPublicByIds(ids: string[]): Promise<UserDto[]> {
    const users = await this.userModel.find({ _id: { $in: ids } }).exec();
    return users.map(toPublicUser);
  }
}
