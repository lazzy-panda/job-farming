export type ProxyEntry = {
  id: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
};

export interface ProxyProvider {
  getNext(): Promise<ProxyEntry | null>;
  markBad(proxyId: string, reason?: string): Promise<void>;
}

export interface SourceContext {
  sourceId: string;
  sourceType: string;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SourceConnector {
  /**
   * Poll and return new job postings for a source.
   */
  fetchNewJobs(ctx: SourceContext): Promise<
    Array<{
      title: string;
      description?: string;
      company?: string;
      location?: string;
      link?: string;
      tags?: string;
      publishedAt?: Date;
      messageId?: number;
      channel?: string;
      attachments?: string[];
      hash?: string;
    }>
  >;
}
