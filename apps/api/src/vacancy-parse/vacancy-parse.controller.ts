import { Body, Controller, Post } from '@nestjs/common';
import type { ParseResult } from '@job-farm/vacancy-parser';
import { VacancyParseRequestDto } from './vacancy-parse.dto';
import { VacancyParseService } from './vacancy-parse.service';

@Controller('vacancies')
export class VacancyParseController {
  constructor(private readonly vacancyParseService: VacancyParseService) {}

  @Post('parse')
  parse(@Body() body: VacancyParseRequestDto): ParseResult {
    return this.vacancyParseService.parse({
      text: body.text,
      pageTitle: body.pageTitle,
      sourceUrl: body.sourceUrl,
      debug: body.debug,
    });
  }
}
