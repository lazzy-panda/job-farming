import { Module } from '@nestjs/common';
import { VacancyParseController } from './vacancy-parse.controller';
import { VacancyParseService } from './vacancy-parse.service';

@Module({
  controllers: [VacancyParseController],
  providers: [VacancyParseService],
})
export class VacancyParseModule {}
