import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { PostEntity } from './post.entity';

@Entity('post_images')
export class PostImageEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  url!: string;

  @Column({ name: 'cloudinary_public_id', type: 'varchar', length: 255, nullable: true })
  cloudinaryPublicId?: string | null;

  @ManyToOne(() => PostEntity, (post) => post.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post!: PostEntity;

  @Column({ name: 'post_id', type: 'int', nullable: false })
  postId!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
