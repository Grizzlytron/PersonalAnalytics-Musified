import { MuseRawEegEntity } from '../../entities/MuseRawEegEntity';
import { MuseMetadataEntity } from '../../entities/MuseMetadataEntity';
import getMainLogger from '../../../config/Logger';

const LOG = getMainLogger('MuseTrackerService');

export interface RawEegSample {
  timestamp: Date;
  tp9: number;
  af7: number;
  af8: number;
  tp10: number;
}

export interface MetadataSample {
  timestamp: Date;
  batteryLevel?: number;
  hsiTp9?: number;
  hsiAf7?: number;
  hsiAf8?: number;
  hsiTp10?: number;
  signalQuality?: number;
}

export class MuseTrackerService {
  private static finiteNumberOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  public static async saveRawEegBatch(samples: RawEegSample[]): Promise<void> {
    if (samples.length === 0) {
      return;
    }

    try {
      await MuseRawEegEntity.createQueryBuilder()
        .insert()
        .into(MuseRawEegEntity)
        .values(
          samples.map((sample) => ({
            timestamp: sample.timestamp,
            tp9: sample.tp9,
            af7: sample.af7,
            af8: sample.af8,
            tp10: sample.tp10
          }))
        )
        .execute();
    } catch (error) {
      LOG.error('Error saving raw Muse EEG batch', error);
      throw error;
    }
  }

  public static async saveMetadataSample(sample: MetadataSample): Promise<void> {
    try {
      await MuseMetadataEntity.createQueryBuilder()
        .insert()
        .into(MuseMetadataEntity)
        .values({
          timestamp: sample.timestamp,
          batteryLevel: MuseTrackerService.finiteNumberOrUndefined(sample.batteryLevel),
          hsiTp9: MuseTrackerService.finiteNumberOrUndefined(sample.hsiTp9),
          hsiAf7: MuseTrackerService.finiteNumberOrUndefined(sample.hsiAf7),
          hsiAf8: MuseTrackerService.finiteNumberOrUndefined(sample.hsiAf8),
          hsiTp10: MuseTrackerService.finiteNumberOrUndefined(sample.hsiTp10),
          signalQuality: MuseTrackerService.finiteNumberOrUndefined(sample.signalQuality)
        })
        .execute();
    } catch (error) {
      LOG.error('Error saving Muse metadata sample', error);
      throw error;
    }
  }

  public async getLatestMetadata(): Promise<MuseMetadataEntity | null> {
    try {
      const rows = await MuseMetadataEntity.find({
        order: { timestamp: 'DESC' },
        take: 1
      });
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      LOG.error('Error retrieving latest Muse metadata', error);
      return null;
    }
  }

  public async getMostRecentRawEegData(itemCount: number): Promise<MuseRawEegEntity[]> {
    try {
      const entities = await MuseRawEegEntity.find({
        order: { timestamp: 'DESC' },
        take: itemCount
      });
      return entities;
    } catch (error) {
      LOG.error('Error retrieving raw Muse EEG data', error);
      throw error;
    }
  }

  public async getRawEegDataByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<MuseRawEegEntity[]> {
    try {
      const entities = await MuseRawEegEntity.createQueryBuilder('muse')
        .where('muse.timestamp BETWEEN :startDate AND :endDate', { startDate, endDate })
        .orderBy('muse.timestamp', 'ASC')
        .getMany();
      return entities;
    } catch (error) {
      LOG.error('Error retrieving raw Muse EEG data by date range', error);
      throw error;
    }
  }

  public async getRawEegDataForExport(limit: number = 5000): Promise<MuseRawEegEntity[]> {
    try {
      const recent = await MuseRawEegEntity.find({ order: { timestamp: 'DESC' }, take: limit });
      return recent.reverse();
    } catch (error) {
      LOG.error('Error retrieving raw Muse EEG data for export', error);
      throw error;
    }
  }

  public async getRawEegTrackedMinutes(): Promise<number> {
    try {
      // Count only contiguous recording time.
      // Large timestamp gaps (e.g. device disconnected) are excluded.
      const maxGapMs = 5000;
      const rows = await MuseRawEegEntity.getRepository().query(
        `
          SELECT
            SUM(
              CASE
                WHEN prev_ts IS NULL THEN 0
                WHEN delta_ms <= ? THEN delta_ms
                ELSE 0
              END
            ) AS active_ms
          FROM (
            SELECT
              timestamp AS ts,
              LAG(timestamp) OVER (ORDER BY timestamp) AS prev_ts,
              (julianday(timestamp) - julianday(LAG(timestamp) OVER (ORDER BY timestamp))) * 86400000.0 AS delta_ms
            FROM muse_raw_eeg
          )
        `,
        [maxGapMs]
      );

      const activeMs = Number(rows?.[0]?.active_ms ?? 0);
      if (!Number.isFinite(activeMs) || activeMs <= 0) {
        return 0;
      }

      return activeMs / 60000;
    } catch (error) {
      LOG.error('Error computing raw EEG tracked minutes', error);
      return 0;
    }
  }
}
