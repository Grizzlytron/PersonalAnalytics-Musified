import type { ExperienceSamplingAnswerType } from '../StudyConfiguration';

export default interface ExperienceSamplingDto {
  id: string;
  question: string;
  answerType: ExperienceSamplingAnswerType;
  responseOptions: string | null;
  scale: number | null;
  response: string | null;
  skipped: boolean;
  promptedAt: Date | string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
