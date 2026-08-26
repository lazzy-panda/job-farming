export interface ProxyDbRow {
  id: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks5';
  username: string | null;
  password: string | null;
  userAgent: string | null;
  userAgentSource: string | null;
  userAgentUpdatedAt: Date | null;
  cookieHeader: string | null;
  cookieSource: string | null;
  cookieUpdatedAt: Date | null;
  active: boolean;
  lastCheckedAt: Date | null;
  lastStatus: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
