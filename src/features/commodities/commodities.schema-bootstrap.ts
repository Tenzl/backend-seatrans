import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Ensures the `cargo_types` catalog table exists and is seeded. Mirrors
 * InquirySchemaBootstrap — runs the idempotent Postgres SQL on module init so the
 * cargo-type CRUD endpoints work without a manual migration.
 */
@Injectable()
export class CommoditiesSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(CommoditiesSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const sqlPath = join(process.cwd(), '..', 'docs/sql/2026-06-12_cargo_types_postgres.sql');

    try {
      const sql = readFileSync(sqlPath, 'utf8');
      await this.dataSource.query(sql);
      this.logger.log('Cargo type catalog schema ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cargo type catalog schema bootstrap failed: ${message}`);
    }
  }
}
