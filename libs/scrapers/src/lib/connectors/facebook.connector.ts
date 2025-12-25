import { SourceConnector, SourceContext } from '../scrapers';

export class FacebookConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: использовать доступные API/экспорты, ctx.metadata для параметров поиска
    console.log('Facebook API placeholder for', ctx.sourceId);
    return [];
  }
}

