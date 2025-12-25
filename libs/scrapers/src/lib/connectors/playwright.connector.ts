import { SourceConnector, SourceContext } from '../scrapers';

export class PlaywrightConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext) {
    // TODO: подключить Playwright/Puppeteer для SPA-страниц
    console.log('Playwright/Puppeteer placeholder for', ctx.url);
    return [];
  }
}

