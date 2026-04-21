import { MuseRawEegEntity } from '../../entities/MuseRawEegEntity';
import { MuseRawOpticsEntity } from '../../entities/MuseRawOpticsEntity';
import { MuseMetadataEntity } from '../../entities/MuseMetadataEntity';
import getMainLogger from '../../../config/Logger';

const LOG = getMainLogger('MuseTrackerService');
const SQLITE_MAX_VARIABLES = 999;
const RAW_EEG_COLUMNS_PER_ROW = 5;
const RAW_OPTICS_COLUMNS_PER_ROW = 5;
const RAW_EEG_SAMPLING_HZ = 256;

export interface RawEegSample {
  timestamp: Date;
  tp9: number;
  af7: number;
  af8: number;
  tp10: number;
}

export interface RawOpticsSample {
  timestamp: Date;
  ch0: number;
  ch1: number;
  ch2: number;
  ch3: number;
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
  private static trackedMinutesCache:
    | {
        initialized: boolean;
        activeMs: number;
        lastProcessedId: number;
        lastProcessedTimestamp: Date | null;
      }
    | undefined;

  private static chunkSizeForColumns(columnsPerRow: number): number {
    return Math.max(1, Math.floor(SQLITE_MAX_VARIABLES / columnsPerRow));
  }

  private static parseFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private static parseTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const direct = new Date(trimmed);
    if (Number.isFinite(direct.getTime())) {
      return direct;
    }

    const withT =
      trimmed.includes(' ') && !trimmed.includes('T') ? trimmed.replace(' ', 'T') : trimmed;
    const normalized = new Date(withT);
    if (Number.isFinite(normalized.getTime())) {
      return normalized;
    }

    const sqliteMatch = withT.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/
    );
    if (!sqliteMatch) {
      return null;
    }

    const [, year, month, day, hour, minute, second, fractional] = sqliteMatch;
    const ms = fractional ? Number(fractional.slice(0, 3).padEnd(3, '0')) : 0;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      ms
    );

    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private static finiteNumberOrUndefined(value: unknown): number | undefined {
    return MuseTrackerService.parseFiniteNumber(value);
  }

  private static normalizePositiveNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private static normalizeNonNegativeInteger(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  private static async initializeTrackedMinutesCache(maxGapMs: number): Promise<void> {
    if (MuseTrackerService.trackedMinutesCache?.initialized) {
      return;
    }

    const [maxIdRows, countRows, latestRows] = await Promise.all([
      MuseRawEegEntity.getRepository().query(
        'SELECT COALESCE(MAX(id), 0) AS max_id FROM muse_raw_eeg'
      ),
      MuseRawEegEntity.getRepository().query('SELECT COUNT(*) AS c FROM muse_raw_eeg'),
      MuseRawEegEntity.getRepository().query(
        `
          SELECT id, timestamp
          FROM muse_raw_eeg
          ORDER BY id DESC
          LIMIT 1
        `
      )
    ]);

    const lastProcessedId = MuseTrackerService.normalizeNonNegativeInteger(maxIdRows?.[0]?.max_id);
    const totalRows = MuseTrackerService.normalizeNonNegativeInteger(countRows?.[0]?.c);

    const latestTimestamp = latestRows?.[0]
      ? MuseTrackerService.parseTimestamp(latestRows[0].timestamp)
      : null;

    // Bootstrap from an O(1) estimate instead of a full-table window scan.
    // This keeps startup and status polling responsive on multi-million-row databases.
    const estimatedActiveMs = totalRows > 1 ? ((totalRows - 1) / RAW_EEG_SAMPLING_HZ) * 1000 : 0;

    MuseTrackerService.trackedMinutesCache = {
      initialized: true,
      activeMs: MuseTrackerService.normalizePositiveNumber(estimatedActiveMs),
      lastProcessedId,
      lastProcessedTimestamp: latestTimestamp
    };

    // If we could not resolve a valid latest timestamp, avoid adding any gaps from future rows
    // until a valid timestamp appears.
    if (!latestTimestamp && maxGapMs > 0) {
      MuseTrackerService.trackedMinutesCache.lastProcessedTimestamp = null;
    }
  }

  public static async saveRawEegBatch(samples: RawEegSample[]): Promise<void> {
    if (samples.length === 0) {
      return;
    }

    try {
      const chunkSize = MuseTrackerService.chunkSizeForColumns(RAW_EEG_COLUMNS_PER_ROW);
      for (let i = 0; i < samples.length; i += chunkSize) {
        const chunk = samples.slice(i, i + chunkSize);
        await MuseRawEegEntity.createQueryBuilder()
          .insert()
          .into(MuseRawEegEntity)
          .values(
            chunk.map((sample) => ({
              timestamp: sample.timestamp,
              tp9: sample.tp9,
              af7: sample.af7,
              af8: sample.af8,
              tp10: sample.tp10
            }))
          )
          .execute();
      }
    } catch (error) {
      LOG.error('Error saving raw Muse EEG batch', error);
      throw error;
    }
  }

  public static async saveRawOpticsBatch(samples: RawOpticsSample[]): Promise<void> {
    if (samples.length === 0) {
      return;
    }

    try {
      const chunkSize = MuseTrackerService.chunkSizeForColumns(RAW_OPTICS_COLUMNS_PER_ROW);
      for (let i = 0; i < samples.length; i += chunkSize) {
        const chunk = samples.slice(i, i + chunkSize);
        await MuseRawOpticsEntity.createQueryBuilder()
          .insert()
          .into(MuseRawOpticsEntity)
          .values(
            chunk.map((sample) => ({
              timestamp: sample.timestamp,
              ch0: sample.ch0,
              ch1: sample.ch1,
              ch2: sample.ch2,
              ch3: sample.ch3
            }))
          )
          .execute();
      }
    } catch (error) {
      LOG.error('Error saving raw Muse optics batch', error);
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
        order: { timestamp: 'DESC', id: 'DESC' },
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

  public async getMostRecentRawEegDataAsc(itemCount: number): Promise<MuseRawEegEntity[]> {
    try {
      // Keep UI polling fixed-cost regardless of table size by reading only the newest N rows,
      // then ordering those rows chronologically for chart rendering.
      const rows = await MuseRawEegEntity.getRepository().query(
        `
          SELECT id, timestamp, tp9, af7, af8, tp10
          FROM (
            SELECT id, timestamp, tp9, af7, af8, tp10
            FROM muse_raw_eeg
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
          ) recent
          ORDER BY timestamp ASC, id ASC
        `,
        [itemCount]
      );

      const parsedRows: MuseRawEegEntity[] = [];
      for (const row of rows) {
        const timestamp = MuseTrackerService.parseTimestamp(row.timestamp);
        const tp9 = MuseTrackerService.parseFiniteNumber(row.tp9);
        const af7 = MuseTrackerService.parseFiniteNumber(row.af7);
        const af8 = MuseTrackerService.parseFiniteNumber(row.af8);
        const tp10 = MuseTrackerService.parseFiniteNumber(row.tp10);

        if (
          !timestamp ||
          tp9 === undefined ||
          af7 === undefined ||
          af8 === undefined ||
          tp10 === undefined
        ) {
          continue;
        }

        parsedRows.push(
          MuseRawEegEntity.create({
            id: row.id,
            timestamp,
            tp9,
            af7,
            af8,
            tp10
          })
        );
      }

      return parsedRows;
    } catch (error) {
      LOG.error('Error retrieving ascending recent raw Muse EEG data', error);
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
      await MuseTrackerService.initializeTrackedMinutesCache(maxGapMs);

      const cache = MuseTrackerService.trackedMinutesCache;
      if (!cache) {
        return 0;
      }

      const rows = await MuseRawEegEntity.getRepository().query(
        `
          SELECT id, timestamp
          FROM muse_raw_eeg
          WHERE id > ?
          ORDER BY id ASC
        `,
        [cache.lastProcessedId]
      );

      for (const row of rows) {
        const id = MuseTrackerService.normalizeNonNegativeInteger(row.id);
        const timestamp = MuseTrackerService.parseTimestamp(row.timestamp);

        if (id <= cache.lastProcessedId) {
          continue;
        }

        if (timestamp && cache.lastProcessedTimestamp) {
          const deltaMs = timestamp.getTime() - cache.lastProcessedTimestamp.getTime();
          if (deltaMs > 0 && deltaMs <= maxGapMs) {
            cache.activeMs += deltaMs;
          }
        }

        cache.lastProcessedId = id;
        cache.lastProcessedTimestamp = timestamp ?? cache.lastProcessedTimestamp;
      }

      return cache.activeMs > 0 ? cache.activeMs / 60000 : 0;
    } catch (error) {
      LOG.error('Error computing raw EEG tracked minutes', error);
      return 0;
    }
  }
}
