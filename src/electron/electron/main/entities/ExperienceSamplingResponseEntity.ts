import { Column, Entity } from 'typeorm';
import BaseTrackedEntity from './BaseTrackedEntity';

@Entity({ name: 'experience_sampling_responses' })
export class ExperienceSamplingResponseEntity extends BaseTrackedEntity {
  @Column('datetime')
  promptedAt: Date;

  @Column('text')
  question: string;

  @Column('text', { nullable: true })
  question1: string | null;

  @Column('text', { nullable: true })
  question2: string | null;

  @Column('text', { nullable: true })
  responseOptions: string | null;

  @Column('text', { nullable: true })
  responseOptions1: string | null;

  @Column('text', { nullable: true })
  responseOptions2: string | null;

  @Column('int')
  scale: number;

  @Column('int', { nullable: true })
  response: number;

  @Column('int', { nullable: true })
  response1: number | null;

  @Column('int', { nullable: true })
  response2: number | null;

  @Column('boolean', { default: false, nullable: false })
  skipped: boolean;
}
