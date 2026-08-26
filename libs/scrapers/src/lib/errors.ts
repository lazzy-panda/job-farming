export class ProxyBlockedError extends Error {
  constructor(
    public readonly status: number,
    public readonly host?: string,
    public readonly reason?: string,
  ) {
    super(`Proxy blocked with status ${status}${reason ? ` (${reason})` : ''}`);
  }
}
