import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Category } from './category.entity';
import { PostImageEntity } from './post-image.entity';

@Entity('posts')
export class PostEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 500 })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'author_id' })
  author!: User;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl!: string | null;

  @Column({ name: 'thumbnail_public_id', type: 'varchar', length: 255, nullable: true })
  thumbnailPublicId!: string | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'is_published', default: false })
  isPublished!: boolean;

  @Column({ name: 'view_count', default: 0 })
  viewCount!: number;

  @ManyToMany(() => Category, (category) => category.posts)
  @JoinTable({
    name: 'post_categories',
    joinColumn: { name: 'post_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories!: Category[];

  @OneToMany(() => PostImageEntity, (image) => image.post, { cascade: true })
  images!: PostImageEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
