import getMainLogger from '../../config/Logger';
import { UsageDataEventType } from '../../enums/UsageDataEventType.enum';
import { UsageDataEntity } from '../entities/UsageDataEntity';

const LOG = getMainLogger('UsageDataService');

export class UsageDataService {
  public static async createNewUsageDataEvent(
    type: UsageDataEventType,
    additionalInformation?: string
  ): Promise<void> {
    LOG.debug(`Creating new usage data event of type ${type}`);
    const now = new Date();

    try {
      await UsageDataEntity.save({
        type,
        additionalInformation,
        createdAt: now,
        updatedAt: now
      });
    } catch (error) {
      LOG.error(`Failed to persist usage data event of type ${type}`, error);
    }
  }
}
