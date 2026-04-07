export default interface ExperienceSamplingDto {
  id: string;
  question: string;
  responseOptions: string;
  response: number | null;
  question1: string;
  responseOptions1: string;
  response1: number | null;
  question2: string;
  responseOptions2: string;
  response2: number | null;
  scale: number;
  skipped: boolean;
  promptedAt: Date | string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
