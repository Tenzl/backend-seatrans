import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PostEntity } from './post.entity';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 100 })
  name!: string;

  @Column({ unique: true, length: 150 })
  slug!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @ManyToMany(() => PostEntity, (post) => post.categories)
  posts!: PostEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
