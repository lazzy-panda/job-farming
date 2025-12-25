import { SourceConnector, SourceContext } from '../scrapers';

export class TelegramConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: подключить gramjs/tdlib клиента, читать каналы из ctx.metadata
    console.log('Telegram fetch placeholder for', ctx.sourceId);
    return [];
  }
}

