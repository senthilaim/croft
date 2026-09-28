import { IsString, MinLength } from 'class-validator';

export class OidcCallbackDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  state!: string;

  @IsString()
  @MinLength(1)
  codeVerifier!: string;

  @IsString()
  @MinLength(1)
  nonce!: string;
}
