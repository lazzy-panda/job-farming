import { SourceConnector, SourceContext } from '../scrapers';

export class EmailAlertsConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: подключить IMAP/POP3 и парсинг писем с алертами (LinkedIn/Facebook)
    console.log('Email alerts placeholder for', ctx.sourceId);
    return [];
  }
}

