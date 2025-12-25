import { SourceConnector, SourceContext } from '../scrapers';

export class ImapAlertsConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: IMAP/POP3 чтение писем с алертами (LinkedIn/Facebook), парсинг в вакансии
    console.log('IMAP/POP3 alerts placeholder for', ctx.sourceId);
    return [];
  }
}

