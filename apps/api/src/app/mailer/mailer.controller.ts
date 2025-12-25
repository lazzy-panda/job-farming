import { Body, Controller, Post } from '@nestjs/common';
import { MailerService } from './mailer.service';

@Controller('mailer')
export class MailerController {
  constructor(private readonly service: MailerService) {}

  @Post('send')
  send(
    @Body()
    body: {
      to: string;
      subject?: string;
      body?: string;
      templateId?: string;
    },
  ) {
    return this.service.sendEmail(body);
  }
}

