import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema.js';

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
}
