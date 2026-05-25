import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Province } from '../../provinces/entities/province.entity';
import { Port } from '../../ports/entities/port.entity';
import { Commodity } from '../../commodities/entities/commodity.entity';

@Entity('gallery_images')
export class GalleryImage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'image_url', type: 'text' })
  imageUrl!: string;

  @Column({ name: 'province_code', type: 'varchar', length: 32, nullable: true })
  provinceCode!: string | null;

  @Column({ name: 'service_type_id', type: 'int' })
  serviceTypeId!: number;

  @Column({ name: 'commodity_id', type: 'int' })
  commodityId!: number;

  @ManyToOne(() => Commodity, { nullable: false })
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;

  @ManyToOne(() => Province, { nullable: true })
  @JoinColumn({ name: 'province_id' })
  province!: Province | null;

  @ManyToOne(() => Port, { nullable: true })
  @JoinColumn({ name: 'port_id' })
  port!: Port | null;

  @Column({ name: 'uploaded_by_id', type: 'int' })
  uploadedById!: number;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'cloudinary_public_id', type: 'text', nullable: true })
  cloudinaryPublicId!: string | null;
}
