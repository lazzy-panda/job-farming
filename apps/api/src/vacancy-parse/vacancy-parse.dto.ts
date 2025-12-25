import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class VacancyParseRequestDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsString()
  pageTitle?: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @IsBoolean()
  debug?: boolean;
}
