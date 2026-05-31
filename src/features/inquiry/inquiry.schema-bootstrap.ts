import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class InquirySchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(InquirySchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    const sqlPath = join(process.cwd(), '..', 'docs/sql/2026-05-31_epda_customer_field_audit_postgres.sql');

    try {
      const sql = readFileSync(sqlPath, 'utf8');
      await this.dataSource.query(sql);
      this.logger.log('Inquiry EPDA audit schema ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Inquiry EPDA audit schema bootstrap failed: ${message}`);
    }
  }
}
