import { Body, Controller, Post } from '@nestjs/common';
import { MessengerService } from './messenger.service';

@Controller('messenger')
export class MessengerController {
  constructor(private readonly service: MessengerService) {}

  @Post('telegram')
  sendTelegram(
    @Body()
    body: {
      to: string;
      message: string;
    },
  ) {
    return this.service.sendTelegram(body);
  }
}

