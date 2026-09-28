import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import type { BuildfarmNodeType, BuildfarmProvider } from '@croft/shared-types';

const NODE_TYPES: BuildfarmNodeType[] = ['server', 'worker', 'redis', 'cache'];
const PROVIDERS: BuildfarmProvider[] = ['docker', 'aws'];

class PositionDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}

class BuildfarmNodeDto {
  @IsString()
  id!: string;

  @IsIn(NODE_TYPES)
  type!: BuildfarmNodeType;

  @ValidateNested()
  @Type(() => PositionDto)
  position!: PositionDto;

  @IsObject()
  config!: Record<string, unknown>;
}

class BuildfarmEdgeDto {
  @IsString()
  id!: string;

  @IsString()
  source!: string;

  @IsString()
  target!: string;
}

export class SaveBuildfarmConfigDto {
  // Omitted -> 'docker', matching every design saved before this field existed. Not required so
  // existing frontend clients mid-deploy don't suddenly start failing validation.
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: BuildfarmProvider;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildfarmNodeDto)
  nodes!: BuildfarmNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildfarmEdgeDto)
  edges!: BuildfarmEdgeDto[];
}
