import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class InquirySchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(InquirySchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    // Run in order: per-service split first (creates the new tables + shared id
    // sequence), then the EPDA audit schema (references shipping_agency_inquiries).
    const sqlFiles = [
      '2026-06-15_split_inquiries_per_service_postgres.sql',
      '2026-05-31_epda_customer_field_audit_postgres.sql',
    ];

    for (const file of sqlFiles) {
      const sqlPath = join(process.cwd(), '..', 'docs/sql', file);
      try {
        const sql = readFileSync(sqlPath, 'utf8');
        await this.dataSource.query(sql);
        this.logger.log(`Inquiry schema ready: ${file}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Inquiry schema bootstrap failed (${file}): ${message}`);
      }
    }
  }
}
