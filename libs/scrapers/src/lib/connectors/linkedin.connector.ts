import { SourceConnector, SourceContext } from '../scrapers';

export class LinkedInConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: использовать официальный API/экспорты, авторизацию OAuth, ctx.metadata для параметров
    console.log('LinkedIn API placeholder for', ctx.sourceId);
    return [];
  }
}

