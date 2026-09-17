import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsObject, IsString, ValidateNested } from 'class-validator';
import type { BuildfarmNodeType } from '@croft/shared-types';

const NODE_TYPES: BuildfarmNodeType[] = ['server', 'worker', 'redis', 'cache'];

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildfarmNodeDto)
  nodes!: BuildfarmNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildfarmEdgeDto)
  edges!: BuildfarmEdgeDto[];
}
