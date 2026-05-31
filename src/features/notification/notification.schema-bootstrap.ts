import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Ensures notifications table exists (idempotent SQL). Avoids 500s when
 * db:migrate:notifications was not run on a fresh database.
 */
@Injectable()
export class NotificationSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(NotificationSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const sqlPath = join(process.cwd(), '..', 'docs/sql/2026-05-29_notifications_postgres.sql');

    try {
      const sql = readFileSync(sqlPath, 'utf8');
      await this.dataSource.query(sql);
      this.logger.log('Notifications schema ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notifications schema bootstrap failed: ${message}`);
    }
  }
}
