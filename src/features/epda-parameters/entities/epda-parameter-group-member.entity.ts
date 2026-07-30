import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Port } from '../../ports/entities/port.entity';
import { EpdaParameterSet } from './epda-parameter-set.entity';

@Entity('epda_parameter_group_members')
export class EpdaParameterGroupMember {
  @PrimaryColumn({ name: 'group_id', type: 'int' })
  groupId!: number;

  @PrimaryColumn({ name: 'port_id', type: 'int' })
  portId!: number;

  @ManyToOne(() => EpdaParameterSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group?: EpdaParameterSet;

  @ManyToOne(() => Port, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'port_id' })
  port?: Port;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
