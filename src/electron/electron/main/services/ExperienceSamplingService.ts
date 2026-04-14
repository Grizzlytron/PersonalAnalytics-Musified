import { ExperienceSamplingResponseEntity } from '../entities/ExperienceSamplingResponseEntity';
import getMainLogger from '../../config/Logger';
import ExperienceSamplingDto from '../../../shared/dto/ExperienceSamplingDto';
import type { ExperienceSamplingAnswerType } from '../../../shared/StudyConfiguration';

const LOG = getMainLogger('ExperienceSamplingService');

export class ExperienceSamplingService {
  public async createExperienceSample(
    promptedAt: Date,
    question1: string,
    responseOptions1: string,
    question2: string,
    answerType: ExperienceSamplingAnswerType,
    responseOptions2: string | null,
    scale: number | null,
    response1?: number,
    response2??: string,
    skipped: boolean
  ): Promise<void> {
    LOG.debug(
      `createExperienceSample: promptedAt=${promptedAt}, question1=${question1}, response1=${response1}, question2=${question2}, response2=${response2}, skipped=${skipped}`
    );
    await ExperienceSamplingResponseEntity.save({
      question: question1,
      question1,
      question2,
      responseOptions: responseOptions1,
      responseOptions1,
      answerType,
      responseOptions2,
      scale,
      response: response1,
      response1,
      response2,
      promptedAt,
      skipped
    });
  }

  public async getMostRecentExperienceSamplingDtos(
    itemCount: number
  ): Promise<ExperienceSamplingDto[]> {
    const experienceSamplingResponses = await ExperienceSamplingResponseEntity.find({
      order: { promptedAt: 'DESC' },
      take: itemCount
    });
    return experienceSamplingResponses.map((response) => ({
      id: response.id,
      question: response.question1 ?? response.question,
      question1: response.question1 ?? response.question,
      question2: response.question2 ?? response.question,
      answerType: response.answerType,
      responseOptions: response.responseOptions1 ?? response.responseOptions,
      responseOptions1: response.responseOptions1 ?? response.responseOptions,
      responseOptions2: response.responseOptions2 ?? response.responseOptions,
      scale: response.scale,
      response: response.response1 ?? response.response,
      response1: response.response1 ?? response.response,
      response2: response.response2 ?? response.response,
      promptedAt: response.promptedAt,
      skipped: response.skipped,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      deletedAt: response.deletedAt
    }));
  }
}
