import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InquiryDocumentType } from '../enums/inquiry-document-type.enum';
import { User } from '../../auth/entities/user.entity';

@Entity('inquiry_documents')
export class InquiryDocument {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'service_slug', type: 'varchar', length: 100, nullable: false })
  serviceSlug!: string;

  @Column({ name: 'target_id', type: 'bigint', nullable: false })
  targetId!: number;

  @Column({
    name: 'document_type',
    type: 'enum',
    enum: InquiryDocumentType,
    nullable: false,
  })
  documentType!: InquiryDocumentType;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: false })
  fileName!: string;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255, nullable: false })
  originalFileName!: string;

  @Column({ name: 'file_path', type: 'varchar', length: 512, nullable: false })
  filePath!: string;

  @Column({ name: 'file_size', type: 'bigint', nullable: false })
  fileSize!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy!: User;

  @Column({ name: 'cloudinary_url', type: 'text', nullable: true })
  cloudinaryUrl!: string | null;

  @Column({ name: 'cloudinary_public_id', type: 'text', nullable: true })
  cloudinaryPublicId!: string | null;

  @Column({ name: 'version', type: 'int', nullable: false, default: 1 })
  version!: number;

  @Column({ name: 'checksum', type: 'varchar', length: 64, nullable: true })
  checksum!: string | null;

  @Column({ name: 'is_active', type: 'boolean', nullable: false, default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
