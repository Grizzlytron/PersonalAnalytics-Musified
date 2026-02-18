import { MuseEntity } from '../../entities/MuseEntity';
import getMainLogger from '../../../config/Logger';

const LOG = getMainLogger('MuseTrackerService');

export interface MuseData {
  deviceId: string;
  deviceName: string;
  timestamp: Date;
  channel1_TP9?: number;
  channel2_AF7?: number;
  channel3_AF8?: number;
  channel4_TP10?: number;
  ppg?: number;
  batteryLevel?: number;
  signalQuality?: number;
  connectionState?: string;
  additionalData?: string;
}

export class MuseTrackerService {
  public static async handleMuseData(data: MuseData): Promise<void> {
    try {
      LOG.debug(`Saving Muse data from device: ${data.deviceId}`);
      
      const entity = await MuseEntity.save({
        deviceId: data.deviceId,
        deviceName: data.deviceName,
        timestamp: data.timestamp,
        channel1_TP9: data.channel1_TP9,
        channel2_AF7: data.channel2_AF7,
        channel3_AF8: data.channel3_AF8,
        channel4_TP10: data.channel4_TP10,
        ppg: data.ppg,
        batteryLevel: data.batteryLevel,
        signalQuality: data.signalQuality,
        connectionState: data.connectionState,
        additionalData: data.additionalData
      });

      LOG.debug(`Muse data saved with id: ${entity.id}`);
    } catch (error) {
      LOG.error('Error saving Muse data', error);
      throw error;
    }
  }

  // Instance method wrapper for convenience
  public async saveMuseData(data: MuseData): Promise<void> {
    return MuseTrackerService.handleMuseData(data);
  }

  public async getMostRecentMuseData(itemCount: number): Promise<MuseEntity[]> {
    try {
      const entities = await MuseEntity.find({
        order: { timestamp: 'DESC' },
        take: itemCount
      });
      return entities;
    } catch (error) {
      LOG.error('Error retrieving Muse data', error);
      throw error;
    }
  }

  public async getMuseDataByDateRange(startDate: Date, endDate: Date): Promise<MuseEntity[]> {
    try {
      const entities = await MuseEntity.createQueryBuilder('muse')
        .where('muse.timestamp BETWEEN :startDate AND :endDate', { startDate, endDate })
        .orderBy('muse.timestamp', 'ASC')
        .getMany();
      return entities;
    } catch (error) {
      LOG.error('Error retrieving Muse data by date range', error);
      throw error;
    }
  }

  public async getAverageSignalQuality(deviceId: string, timeWindowMs: number = 60000): Promise<number> {
    try {
      const timeThreshold = new Date(Date.now() - timeWindowMs);
      
      const result = await MuseEntity.createQueryBuilder('muse')
        .select('AVG(muse.signalQuality)', 'avgQuality')
        .where('muse.deviceId = :deviceId AND muse.timestamp > :timeThreshold', {
          deviceId,
          timeThreshold
        })
        .getRawOne();

      return result?.avgQuality ?? 0;
    } catch (error) {
      LOG.error('Error calculating average signal quality', error);
      return 0;
    }
  }
}
