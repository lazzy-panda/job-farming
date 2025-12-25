import { SourceConnector, SourceContext } from '../scrapers';

export class HttpSiteConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: реализовать http + cheerio парсинг для ctx.url
    console.log('HttpSite fetch placeholder for', ctx.url);
    return [];
  }
}

