import { Injectable, Logger } from '@nestjs/common';

interface SendTelegramDto {
  to: string;
  message: string;
}

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);

  async sendTelegram(dto: SendTelegramDto) {
    // TODO: интеграция с Telegram client/bot; сейчас — noop-лог
    this.logger.warn(
      `NOOP Telegram send to=${dto.to} message="${dto.message.substring(0, 120)}"`,
    );
    return { status: 'noop', to: dto.to };
  }
}

