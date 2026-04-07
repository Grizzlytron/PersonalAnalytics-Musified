import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn
} from 'typeorm';

@Entity({ name: 'nback_task_blocks' })
export class NBackTaskBlockEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime'
  })
  createdAt: Date;

  @Column('text')
  sessionId: string;

  @Column('text')
  taskId: string;

  @Column('boolean', { default: false })
  withDistractions: boolean;

  @Column('datetime')
  startedAt: Date;

  @Column('datetime')
  completedAt: Date;

  @Column('int')
  completedTrials: number;

  @Column('int')
  correctResponses: number;

  @Column('float')
  accuracyPercent: number;

  @Column('text')
  timingConfig: string;

  @Column('text')
  reflectionQuestion1: string;

  @Column('int')
  reflectionResponse1: number;

  @Column('text')
  reflectionQuestion2: string;

  @Column('int')
  reflectionResponse2: number;

  @Column('text')
  trialResults: string;
}