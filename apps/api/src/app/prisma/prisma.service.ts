import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL || `file:${path.resolve(process.cwd(), 'dev.db')}`;
const preferBetterSqlite = process.env.PREFER_BETTER_SQLITE3 !== '0';

function createPrismaOptions(): ConstructorParameters<typeof PrismaClient>[0] {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = dbUrl;
  }

  if (!preferBetterSqlite) {
    throw new Error(
      'Prisma requires a SQLite driver adapter (PREFER_BETTER_SQLITE3 must not be 0). Set the env var or install another adapter.',
    );
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    return { adapter };
  } catch (err) {
    // eslint-disable-next-line no-console
    const message =
      typeof err === 'object' && err !== null && 'message' in err ? (err as Error).message : String(err);
    throw new Error(
      `[PrismaService] Failed to enable PrismaBetterSqlite3 (required for Prisma 7 sqlite driver): ${message}`,
    );
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super(createPrismaOptions());
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
