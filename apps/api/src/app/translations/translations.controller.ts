import { Body, Controller, Post } from '@nestjs/common';
import { TranslationsService } from './translations.service';

@Controller('translations')
export class TranslationsController {
  constructor(private readonly translations: TranslationsService) {}

  @Post()
  translate(
    @Body()
    body: {
      text?: string;
      targetLang?: string;
      sourceLang?: string;
      jobId?: string;
    },
  ) {
    return this.translations.translate(body ?? {});
  }
}
