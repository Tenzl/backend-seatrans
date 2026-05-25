import { Entity, Column } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';

@Entity('special_request_inquiries')
export class SpecialRequestInquiryEntity extends BaseInquiry {
  @Column({ type: 'varchar', length: 500, nullable: true })
  subject!: string | null;

  @Column({ name: 'preferred_province_id', type: 'bigint', nullable: true })
  preferredProvinceId!: string | null;

  @Column({ name: 'preferred_province_name', type: 'varchar', length: 255, nullable: true })
  preferredProvinceName!: string | null;

  @Column({ name: 'related_department_id', type: 'bigint', nullable: true })
  relatedDepartmentId!: string | null;

  @Column({ name: 'related_department_name', type: 'varchar', length: 255, nullable: true })
  relatedDepartmentName!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'other_info', type: 'text', nullable: true })
  otherInfo!: string | null;
}
