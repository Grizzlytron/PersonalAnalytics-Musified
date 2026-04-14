import { Column, Entity } from 'typeorm';
import BaseTrackedEntity from './BaseTrackedEntity';
import type { ExperienceSamplingAnswerType } from '../../../shared/StudyConfiguration';

@Entity({ name: 'experience_sampling_responses' })
export class ExperienceSamplingResponseEntity extends BaseTrackedEntity {
  @Column('datetime')
  promptedAt: Date;

  @Column('text')
  question: string;

  @Column('text', { default: 'LikertScale' })
  answerType: ExperienceSamplingAnswerType;

  @Column('text', { nullable: true })
  question1: string | null;

  @Column('text', { nullable: true })
  question2: string | null;

  @Column('text', { nullable: true })
  responseOptions: string | null;

<<<<<<< HEAD
  @Column('text', { nullable: true })
  responseOptions1: string | null;

  @Column('text', { nullable: true })
  responseOptions2: string | null;


  @Column('int')
  scale: number;

=======
>>>>>>> upstream/main
  @Column('int', { nullable: true })
  scale: number | null;

  @Column('text', { nullable: true })
  response: string | null;

  @Column('int', { nullable: true })
  response1: number | null;

  @Column('int', { nullable: true })
  response2: number | null;

  @Column('boolean', { default: false, nullable: false })
  skipped: boolean;
}
