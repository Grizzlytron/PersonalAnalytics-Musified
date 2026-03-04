import { MuseEntity } from '../../entities/MuseEntity';
import getMainLogger from '../../../config/Logger';

const LOG = getMainLogger('MuseTrackerService');

export interface MuseData {
  deviceId: string;
  deviceName: string;
  timestamp: Date;
  // EEG channels
  channel1_TP9?: number;
  channel2_AF7?: number;
  channel3_AF8?: number;
  channel4_TP10?: number;
  // Heart rate
  ppg?: number;
  heartRate?: number;
  // Device status
  batteryLevel?: number;
  signalQuality?: number;
  connectionState?: string;
  // Band powers - Relative
  alphaRelative?: number;
  betaRelative?: number;
  deltaRelative?: number;
  thetaRelative?: number;
  gammaRelative?: number;
  // Band powers - Absolute
  alphaAbsolute?: number;
  betaAbsolute?: number;
  deltaAbsolute?: number;
  thetaAbsolute?: number;
  gammaAbsolute?: number;
  // Band powers - Scores
  alphaScore?: number;
  betaScore?: number;
  deltaScore?: number;
  thetaScore?: number;
  gammaScore?: number;
  // Quality indicators
  isGood?: number;
  varianceEeg?: number;
  // Movement
  accelerometerAvg?: number;
  gyroAvg?: number;
  // Metadata
  additionalData?: string;
}

export class MuseTrackerService {
  private static finiteNumberOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  public static async handleMuseData(data: MuseData): Promise<void> {
    try {
      LOG.debug(`Saving Muse data from device: ${data.deviceId}`);

      const entity = await MuseEntity.save({
        deviceId: data.deviceId,
        deviceName: data.deviceName,
        timestamp: data.timestamp,
        // EEG channels
        channel1_TP9: MuseTrackerService.finiteNumberOrUndefined(data.channel1_TP9),
        channel2_AF7: MuseTrackerService.finiteNumberOrUndefined(data.channel2_AF7),
        channel3_AF8: MuseTrackerService.finiteNumberOrUndefined(data.channel3_AF8),
        channel4_TP10: MuseTrackerService.finiteNumberOrUndefined(data.channel4_TP10),
        // Heart rate
        ppg: MuseTrackerService.finiteNumberOrUndefined(data.ppg),
        heartRate: MuseTrackerService.finiteNumberOrUndefined(data.heartRate),
        // Device status
        batteryLevel: MuseTrackerService.finiteNumberOrUndefined(data.batteryLevel),
        signalQuality: MuseTrackerService.finiteNumberOrUndefined(data.signalQuality),
        connectionState: data.connectionState,
        // Band powers - Relative
        alphaRelative: MuseTrackerService.finiteNumberOrUndefined(data.alphaRelative),
        betaRelative: MuseTrackerService.finiteNumberOrUndefined(data.betaRelative),
        deltaRelative: MuseTrackerService.finiteNumberOrUndefined(data.deltaRelative),
        thetaRelative: MuseTrackerService.finiteNumberOrUndefined(data.thetaRelative),
        gammaRelative: MuseTrackerService.finiteNumberOrUndefined(data.gammaRelative),
        // Band powers - Absolute
        alphaAbsolute: MuseTrackerService.finiteNumberOrUndefined(data.alphaAbsolute),
        betaAbsolute: MuseTrackerService.finiteNumberOrUndefined(data.betaAbsolute),
        deltaAbsolute: MuseTrackerService.finiteNumberOrUndefined(data.deltaAbsolute),
        thetaAbsolute: MuseTrackerService.finiteNumberOrUndefined(data.thetaAbsolute),
        gammaAbsolute: MuseTrackerService.finiteNumberOrUndefined(data.gammaAbsolute),
        // Band powers - Scores
        alphaScore: MuseTrackerService.finiteNumberOrUndefined(data.alphaScore),
        betaScore: MuseTrackerService.finiteNumberOrUndefined(data.betaScore),
        deltaScore: MuseTrackerService.finiteNumberOrUndefined(data.deltaScore),
        thetaScore: MuseTrackerService.finiteNumberOrUndefined(data.thetaScore),
        gammaScore: MuseTrackerService.finiteNumberOrUndefined(data.gammaScore),
        // Quality indicators
        isGood: MuseTrackerService.finiteNumberOrUndefined(data.isGood),
        varianceEeg: MuseTrackerService.finiteNumberOrUndefined(data.varianceEeg),
        // Movement
        accelerometerAvg: MuseTrackerService.finiteNumberOrUndefined(data.accelerometerAvg),
        gyroAvg: MuseTrackerService.finiteNumberOrUndefined(data.gyroAvg),
        // Metadata
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

  public async getAverageSignalQuality(
    deviceId: string,
    timeWindowMs: number = 60000
  ): Promise<number> {
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
