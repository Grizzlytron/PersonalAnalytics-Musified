import { ExperienceSamplingService } from '../main/services/ExperienceSamplingService';
import { app, dialog, ipcMain, IpcMainInvokeEvent, shell, systemPreferences } from 'electron';
import { WindowService } from '../main/services/WindowService';
import { getMainLogger } from '../config/Logger';
import { TypedIpcMain } from '../../src/utils/TypedIpcMain';
import Commands from '../../src/utils/Commands';
import Events from '../../src/utils/Events';
import { DataExportType } from '../../shared/DataExportType.enum';
import { DataExportFormat } from '../../shared/DataExportFormat.enum';
import StudyInfoDto from '../../shared/dto/StudyInfoDto';
import { Settings } from '../main/entities/Settings';
import studyConfig from '../../shared/study.config';
import { TrackerService } from '../main/services/trackers/TrackerService';
import { WindowActivityTrackerService } from '../main/services/trackers/WindowActivityTrackerService';
import { UserInputTrackerService } from '../main/services/trackers/UserInputTrackerService';
import { MuseTrackerService } from '../main/services/trackers/MuseTrackerService';
import { DataExportService } from '../main/services/DataExportService';
import UserInputDto from '../../shared/dto/UserInputDto';
import WindowActivityDto from '../../shared/dto/WindowActivityDto';
import ExperienceSamplingDto from '../../shared/dto/ExperienceSamplingDto';
import { is } from '../main/services/utils/helpers';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { WorkScheduleService } from 'electron/main/services/WorkScheduleService';
import { WorkHoursDto } from 'shared/dto/WorkHoursDto';
import { MuseRawEegEntity } from '../main/entities/MuseRawEegEntity';
import { MuseRawOpticsEntity } from '../main/entities/MuseRawOpticsEntity';
import {
  getActivitySessions,
  getAppUsageSessions,
  getLongestTimeActiveInsight,
  ActivitySessions,
  TimeActive
} from '../main/services/RetrospectionService';
import { SchedulingService } from '../main/services/SchedulingService';
import path from 'path';
import type { ExperienceSamplingAnswerType } from '../../shared/StudyConfiguration';
import type { NBackTaskBlockDto } from '../../shared/dto/NBackTaskBlockDto';
import { NBackTaskBlockEntity } from '../main/entities/NBackTaskBlockEntity';

const LOG = getMainLogger('IpcHandler');

export class IpcHandler {
  private actions: any;
  private readonly windowService: WindowService;
  private readonly trackerService: TrackerService;
  private readonly MUSE_STATUS_METRICS_REFRESH_MS = 30000;
  private readonly MUSE_DENSE_EEG_WINDOW_ROWS = 9000;
  private readonly MUSE_LIGHT_EEG_WINDOW_ROWS = 600;
  private museStatusMetrics = {
    lastRefreshedAt: 0,
    totalDataPoints: 0,
    trackedMinutes: 0
  };
  private museStatusMetricsRefreshPromise: Promise<void> | null = null;

  private readonly experienceSamplingService: ExperienceSamplingService;
  private readonly windowActivityService: WindowActivityTrackerService;
  private readonly userInputService: UserInputTrackerService;
  private readonly dataExportService: DataExportService;
  private readonly workScheduleService: WorkScheduleService;
  private schedulingService!: SchedulingService;
  private typedIpcMain: TypedIpcMain<Events, Commands> = ipcMain as TypedIpcMain<Events, Commands>;

  constructor(
    windowService: WindowService,
    trackerService: TrackerService,
    experienceSamplingService: ExperienceSamplingService,
    workScheduleService: WorkScheduleService
  ) {
    this.windowService = windowService;
    this.trackerService = trackerService;
    this.experienceSamplingService = experienceSamplingService;
    this.windowActivityService = new WindowActivityTrackerService();
    this.userInputService = new UserInputTrackerService();
    this.dataExportService = new DataExportService();
    this.workScheduleService = workScheduleService;
  }

  public setSchedulingService(schedulingService: SchedulingService): void {
    this.schedulingService = schedulingService;
  }

  public async init(): Promise<void> {
    this.actions = {
      openLogs: this.openLogs,
      openCollectedData: this.openCollected,
      getWorkHours: this.getWorkHours,
      setWorkHours: this.setWorkHours,
      setSettingsProp: this.setSettingsProp,
      getSettings: this.getSettings,
      createExperienceSample: this.createExperienceSample,
      resizeExperienceSamplingWindow: this.resizeExperienceSamplingWindow,
      closeExperienceSamplingWindow: this.closeExperienceSamplingWindow,
      openNBackWindow: this.openNBackWindow,
      closeNBackWindow: this.closeNBackWindow,
      setNBackSessionContext: this.setNBackSessionContext,
      closeOnboardingWindow: this.closeOnboardingWindow,
      closeDataExportWindow: this.closeDataExportWindow,
      saveNBackTaskBlock: this.saveNBackTaskBlock,
      getStudyInfo: this.getStudyInfo,
      getMostRecentExperienceSamplingDtos: this.getMostRecentExperienceSamplingDtos,
      getMostRecentWindowActivityDtos: this.getMostRecentWindowActivityDtos,
      getMostRecentUserInputDtos: this.getMostRecentUserInputDtos,
      obfuscateWindowActivityDtosById: this.obfuscateWindowActivityDtosById,
      startDataExport: this.startDataExport,
      revealItemInFolder: this.revealItemInFolder,
      openUploadUrl: this.openUploadUrl,
      showDataExportError: this.showDataExportError,
      confirmDDLUpload: this.confirmDDLUpload,
      startAllTrackers: this.startAllTrackers,
      triggerPermissionCheckAccessibility: this.triggerPermissionCheckAccessibility,
      triggerPermissionCheckScreenRecording: this.triggerPermissionCheckScreenRecording,
      retrospectionGetActivities: this.retrospectionGetActivities,
      retrospectionLoadLongestTimeActive: this.retrospectionLoadLongestTimeActive,
      retrospectionGetTopThreeMostActiveApps: this.retrospectionGetTopThreeMostActiveApps,
      openRetrospection: this.openRetrospection,
      closeRetrospectionWindow: this.closeRetrospectionWindow,
      'muse:get-tracker-status': this.getMuseTrackerStatus,
      'muse:get-connection-health': this.getMuseConnectionHealth,
      'muse:get-summary-metrics': this.getMuseSummaryMetrics,
      'muse:start-tracker': this.startMuseTracker,
      'muse:stop-tracker': this.stopMuseTracker,
      'muse:get-data-for-export': this.getMuseDataForExport,
      'muse:get-optics-for-export': this.getMuseOpticsForExport,
      'muse:get-discovered-devices': this.getDiscoveredDevices,
      'muse:connect-device': this.connectToDevice,
      'muse:disconnect-device': this.disconnectDevice
    };

    Object.keys(this.actions).forEach((action: string): void => {
      LOG.info(`ipcMain.handle setup: ${action}`);
      ipcMain.handle(action, async (_event: IpcMainInvokeEvent, ...args): Promise<any> => {
        try {
          return await this.actions[action].apply(this, args);
        } catch (error) {
          LOG.error(error);
          // return error;
          throw error;
        }
      });
    });
  }

  private async createExperienceSample(
    promptedAt: Date,
    question: string,
    answerType: ExperienceSamplingAnswerType,
    responseOptions: string | null,
    scale: number | null,
    response: string | undefined,
    question2: string | null,
    answerType2: ExperienceSamplingAnswerType | null,
    responseOptions2: string | null,
    scale2: number | null,
    response2: string | undefined,
    skipped: boolean = false
  ) {
    await this.experienceSamplingService.createExperienceSample(
      promptedAt,
      question,
      answerType,
      responseOptions,
      scale,
      response,
      question2,
      answerType2,
      responseOptions2,
      scale2,
      response2,
      skipped
    );
  }

  private openLogs() {
    LOG.info(`Opening logs at ${app.getPath('logs')}`);
    shell.openPath(`${app.getPath('logs')}`);
  }

  private openCollected() {
    LOG.info(`Opening collected data at ${app.getPath('userData')}`);
    shell.showItemInFolder(path.join(app.getPath('userData'), 'database.sqlite'));
  }

  private resizeExperienceSamplingWindow(height: number): void {
    this.windowService.resizeExperienceSamplingWindow(height);
  }

  private closeExperienceSamplingWindow(skippedExperienceSampling: boolean): void {
    this.windowService.closeExperienceSamplingWindow(skippedExperienceSampling);
  }

  private async openNBackWindow(): Promise<void> {
    await this.windowService.createNBackWindow();
  }

  private closeNBackWindow(source?: string): void {
    this.windowService.closeNBackWindow(source);
  }

  private setNBackSessionContext(context: {
    sessionId?: string;
    workflowState?: string;
    currentTaskIndex?: number;
    currentLevel?: string;
    randomizedLevelOrder?: string[];
    remainingLevels?: string[];
    abandoned?: boolean;
  }): void {
    this.windowService.setNBackSessionContext(context);
  }

  private closeOnboardingWindow(): void {
    this.windowService.closeOnboardingWindow();
  }

  private closeDataExportWindow(): void {
    this.windowService.closeDataExportWindow();
  }

  private async saveNBackTaskBlock(payload: NBackTaskBlockDto): Promise<void> {
    await NBackTaskBlockEntity.save({
      sessionId: payload.sessionId,
      taskId: payload.taskId,
      withDistractions: payload.withDistractions,
      startedAt: new Date(payload.startedAt),
      completedAt: new Date(payload.completedAt),
      completedTrials: payload.completedTrials,
      correctResponses: payload.correctResponses,
      accuracyPercent: payload.accuracyPercent,
      timingConfig: JSON.stringify(payload.timingConfig),
      reflectionQuestion1: payload.reflectionQuestion1,
      reflectionResponse1: payload.reflectionResponse1,
      reflectionQuestion2: payload.reflectionQuestion2,
      reflectionResponse2: payload.reflectionResponse2,
      trialResults: JSON.stringify(payload.trialResults)
    });
  }

  private async getWorkHours(): Promise<WorkHoursDto> {
    return this.workScheduleService.getWorkSchedule();
  }

  private async setWorkHours(schedule: WorkHoursDto): Promise<void> {
    await this.workScheduleService.setWorkSchedule(schedule);

    if (this.schedulingService) {
      this.schedulingService.updateRetrospectionJobs(schedule);
    }
  }

  private async setSettingsProp(prop: string, value: any): Promise<void> {
    const settings = await Settings.findOne({ where: { onlyOneEntityShouldExist: 1 } });
    if (!settings) throw new Error('Settings not found');
    (settings as any)[prop] = value;
    await settings.save();

    try {
      await this.windowService.updateTray();
    } catch (e) {
      LOG.warn('Failed to update tray after settings change', e);
    }
  }

  private async getSettings(): Promise<Settings> {
    const settings = await Settings.findOne({ where: { onlyOneEntityShouldExist: 1 } });
    if (!settings) {
      throw new Error('Settings not found');
    }
    return settings;
  }

  private async getStudyInfo(): Promise<StudyInfoDto> {
    const settings = await Settings.findOne({ where: { onlyOneEntityShouldExist: 1 } });
    if (!settings) throw new Error('Settings not found');

    const window = new JSDOM('').window;
    const purify = DOMPurify(window);

    const cleanDescription = purify.sanitize(studyConfig.shortDescription, {
      ALLOWED_TAGS: ['a', 'b', 'br', 'i', 'li', 'p', 'strong', 'u', 'ul'],
      ADD_ATTR: ['target']
    });

    return {
      studyName: settings.studyName,
      subjectId: settings.subjectId,
      shortDescription: cleanDescription,
      infoUrl: studyConfig.infoUrl,
      privacyPolicyUrl: studyConfig.privacyPolicyUrl,
      contactName: studyConfig.contactName,
      contactEmail: studyConfig.contactEmail,
      appVersion: app.getVersion(),
      currentlyActiveTrackers: this.trackerService.getRunningTrackerNames(),
      enabledWorkHours: settings.enabledWorkHours
    };
  }

  private async getMostRecentExperienceSamplingDtos(
    itemCount: number
  ): Promise<ExperienceSamplingDto[]> {
    return await this.experienceSamplingService.getMostRecentExperienceSamplingDtos(itemCount);
  }

  private async getMostRecentWindowActivityDtos(itemCount: number): Promise<WindowActivityDto[]> {
    return await this.windowActivityService.getMostRecentWindowActivityDtos(itemCount);
  }

  private async obfuscateWindowActivityDtosById(ids: string[]): Promise<WindowActivityDto[]> {
    return await this.windowActivityService.obfuscateWindowActivityDtosById(ids);
  }

  private async getMostRecentUserInputDtos(itemCount: number): Promise<UserInputDto[]> {
    return await this.userInputService.getMostRecentUserInputDtos(itemCount);
  }

  private async startDataExport(
    windowActivityExportType: DataExportType,
    userInputExportType: DataExportType,
    obfuscationTerms: string[],
    encryptData: boolean,
    exportFormat: DataExportFormat,
    exportDDLProjectName?: string
  ): Promise<{ fullPath: string; fileName: string }> {
    return this.dataExportService.startDataExport(
      windowActivityExportType,
      userInputExportType,
      obfuscationTerms,
      encryptData,
      exportFormat,
      exportDDLProjectName
    );
  }

  private async revealItemInFolder(path: string): Promise<void> {
    this.windowService.showItemInFolder(path);
  }

  private async openUploadUrl(): Promise<void> {
    this.windowService.openExternal();
  }

  private async confirmDDLUpload(): Promise<boolean> {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Yes', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Confirm Data Donation',
      message: `Do you agree to donate and upload your data to the ${studyConfig.name} study?`,
      detail:
        "Your data will be uploaded via a secure, encrypted connection to a secure, encrypted store operated by the University of Zurich (Data Donation Lab). Your data will be processed in accordance with the study's consent form."
    });
    return response === 0;
  }

  private async showDataExportError(errorMessage?: string): Promise<void> {
    const message =
      `Please try again. If the export keeps failing, contact the study team (${studyConfig.contactName}, ${studyConfig.contactEmail}) and send them a screenshot of this error.` +
      (errorMessage ? `\n\nError message: ${errorMessage}` : '');
    dialog.showErrorBox('Study Data Export failed', message);
  }

  private triggerPermissionCheckAccessibility(prompt: boolean): boolean {
    if (is.windows) {
      return true;
    }
    return systemPreferences.isTrustedAccessibilityClient(prompt);
  }

  private triggerPermissionCheckScreenRecording(): boolean {
    if (is.windows) {
      return true;
    }
    const status = systemPreferences.getMediaAccessStatus('screen');
    return status === 'granted';
  }

  private async startAllTrackers(): Promise<void> {
    try {
      await this.trackerService.startAllTrackers();
    } catch (e) {
      LOG.error('Error starting trackers', e);
    }
  }

  private async retrospectionGetActivities(date: Date): Promise<ActivitySessions[]> {
    return await getActivitySessions(new Date(date));
  }

  private async retrospectionLoadLongestTimeActive(date: Date): Promise<TimeActive | undefined> {
    try {
      return await getLongestTimeActiveInsight(new Date(date));
    } catch (error) {
      LOG.error('Error loading longest time active', error);
    }
  }

  private async retrospectionGetTopThreeMostActiveApps(
    date: Date
  ): Promise<ActivitySessions[] | undefined> {
    try {
      return (await getAppUsageSessions(new Date(date)))
        .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
        .slice(0, 3);
    } catch (error) {
      LOG.error('Error loading top apps', error);
    }
  }

  private async openRetrospection(): Promise<void> {
    await this.windowService.createRetrospectionWindow();
  }

  private closeRetrospectionWindow(): void {
    this.windowService.closeRetrospectionWindow();
  }

  private async refreshMuseStatusMetrics(museService: MuseTrackerService): Promise<void> {
    const now = Date.now();
    const isFresh =
      now - this.museStatusMetrics.lastRefreshedAt < this.MUSE_STATUS_METRICS_REFRESH_MS;

    if (isFresh) {
      return;
    }

    if (this.museStatusMetricsRefreshPromise) {
      await this.museStatusMetricsRefreshPromise;
      return;
    }

    this.museStatusMetricsRefreshPromise = (async () => {
      const [totalRows, trackedMinutes] = await Promise.all([
        MuseRawEegEntity.getRepository().query(
          'SELECT COALESCE(MAX(id), 0) AS max_id FROM muse_raw_eeg'
        ),
        museService.getRawEegTrackedMinutes()
      ]);
      const totalDataPoints = Number(totalRows?.[0]?.max_id ?? 0);

      this.museStatusMetrics = {
        lastRefreshedAt: Date.now(),
        totalDataPoints: Number.isFinite(totalDataPoints) ? totalDataPoints : 0,
        trackedMinutes
      };
    })();

    try {
      await this.museStatusMetricsRefreshPromise;
    } finally {
      this.museStatusMetricsRefreshPromise = null;
    }
  }

  private downsampleRawEegForUi(
    raw: Array<{
      id: number;
      timestamp: Date;
      tp9: number;
      af7: number;
      af8: number;
      tp10: number;
    }>,
    sampleIntervalMs: number
  ): Array<{ id: number; timestamp: Date; tp9: number; af7: number; af8: number; tp10: number }> {
    const validSamples = raw.filter((sample) =>
      Number.isFinite(new Date(sample.timestamp).getTime())
    );
    if (validSamples.length <= 1) {
      return validSamples;
    }

    const buckets = new Map<number, (typeof raw)[number]>();
    for (const sample of validSamples) {
      const ts = new Date(sample.timestamp).getTime();
      if (!Number.isFinite(ts)) {
        continue;
      }
      const bucket = Math.floor(ts / sampleIntervalMs) * sampleIntervalMs;
      // Keep latest sample in each 500ms bucket.
      buckets.set(bucket, sample);
    }

    if (buckets.size === 0) {
      return [];
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, sample]) => sample);
  }

  // Muse Tracker IPC Handlers
  private async getMuseTrackerStatus(includeDenseData: boolean = true): Promise<any> {
    try {
      const sampleIntervalMs = 500;
      const runningTrackers = this.trackerService.getRunningTrackerNames();
      const isMuseRunning = runningTrackers.includes('MuseTracker');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      const isConnected = !!tracker?.isDeviceConnected?.();

      // Fast-path for disconnected/inactive states to avoid unnecessary DB work on status polls.
      if (!isMuseRunning || !isConnected) {
        return {
          isRunning: isMuseRunning,
          connectedDevice: null,
          qualityUpdatedAtMs: null,
          uiSampleIntervalMs: sampleIntervalMs,
          latestData: [],
          totalDataPoints: this.museStatusMetrics.totalDataPoints,
          trackedMinutes: this.museStatusMetrics.trackedMinutes,
          averageSignalQuality: 0
        };
      }

      // Pull a recent raw window and downsample to 500ms excerpts for UI responsiveness.
      // Non-EEG tabs request a lighter dataset to reduce CPU/IO load.
      // Muse raw EEG is ~256Hz; ~9000 rows keeps around 35s so the 30s UI window can render fully.
      const rawWindowSize = includeDenseData
        ? this.MUSE_DENSE_EEG_WINDOW_ROWS
        : this.MUSE_LIGHT_EEG_WINDOW_ROWS;
      const museService = new MuseTrackerService();
      const recentRawData = await museService.getMostRecentRawEegDataAsc(rawWindowSize);
      const latestData = this.downsampleRawEegForUi(recentRawData, sampleIntervalMs);
      const latestMetadata = await museService.getLatestMetadata();
      const liveQuality = tracker?.getLiveQualitySnapshot?.();

      const pickFinite = (...values: Array<number | null | undefined>): number | undefined => {
        for (const value of values) {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
          }
        }
        return undefined;
      };

      const qualitySnapshot = {
        batteryLevel: pickFinite(liveQuality?.batteryLevel, latestMetadata?.batteryLevel),
        signalQuality: pickFinite(liveQuality?.signalQuality, latestMetadata?.signalQuality),
        hsiTp9: pickFinite(liveQuality?.hsiTp9, latestMetadata?.hsiTp9),
        hsiAf7: pickFinite(liveQuality?.hsiAf7, latestMetadata?.hsiAf7),
        hsiAf8: pickFinite(liveQuality?.hsiAf8, latestMetadata?.hsiAf8),
        hsiTp10: pickFinite(liveQuality?.hsiTp10, latestMetadata?.hsiTp10)
      };
      const qualityUpdatedAtMs =
        (typeof liveQuality?.updatedAtMs === 'number' && Number.isFinite(liveQuality.updatedAtMs)
          ? liveQuality.updatedAtMs
          : undefined) ??
        (() => {
          if (!latestMetadata?.timestamp) {
            return undefined;
          }
          const ts = new Date(latestMetadata.timestamp).getTime();
          return Number.isFinite(ts) ? ts : undefined;
        })() ??
        (() => {
          if (latestData.length === 0) {
            return undefined;
          }
          const ts = new Date(latestData[latestData.length - 1].timestamp).getTime();
          return Number.isFinite(ts) ? ts : undefined;
        })() ??
        null;

      // Refresh heavy aggregate metrics only occasionally to keep UI polling smooth
      // even when the EEG table grows large.
      if (!includeDenseData) {
        await this.refreshMuseStatusMetrics(museService);
      }

      // Get connected device (single device) using live tracker state when available
      let connectedDevice = null;
      if (isConnected) {
        const connectedInfo = tracker?.getConnectedDevice?.();
        connectedDevice = {
          name: connectedInfo?.name || 'Unknown',
          signalQuality: qualitySnapshot.signalQuality ?? null,
          battery: qualitySnapshot.batteryLevel ?? tracker?.getBatteryLevel?.() ?? 0
        };
      }

      let avgQuality = 0;
      const qualityValues = [qualitySnapshot.signalQuality].filter(
        (q): q is number => typeof q === 'number' && Number.isFinite(q)
      );
      if (qualityValues.length > 0) {
        avgQuality = Math.round(
          qualityValues.reduce((sum, q) => sum + q, 0) / qualityValues.length
        );
      }

      return {
        isRunning: isMuseRunning,
        connectedDevice: connectedDevice,
        qualityUpdatedAtMs,
        uiSampleIntervalMs: sampleIntervalMs,
        latestData: latestData.map((d) => ({
          id: d.id,
          timestamp: d.timestamp,
          channel1_TP9: d.tp9,
          channel2_AF7: d.af7,
          channel3_AF8: d.af8,
          channel4_TP10: d.tp10,
          batteryLevel: qualitySnapshot.batteryLevel,
          signalQuality: qualitySnapshot.signalQuality,
          hsiTp9: qualitySnapshot.hsiTp9,
          hsiAf7: qualitySnapshot.hsiAf7,
          hsiAf8: qualitySnapshot.hsiAf8,
          hsiTp10: qualitySnapshot.hsiTp10,
          connectionState: 'connected'
        })),
        totalDataPoints: this.museStatusMetrics.totalDataPoints,
        trackedMinutes: this.museStatusMetrics.trackedMinutes,
        averageSignalQuality: avgQuality
      };
    } catch (error) {
      LOG.error('Error getting Muse tracker status', error);
      return {
        isRunning: false,
        connectedDevice: null,
        latestData: [],
        totalDataPoints: 0,
        averageSignalQuality: 0
      };
    }
  }

  private async getMuseConnectionHealth(): Promise<{
    isRunning: boolean;
    connected: boolean;
    qualityUpdatedAtMs: number | null;
    signalQuality: number | null;
    hsiTp9?: number;
    hsiAf7?: number;
    hsiAf8?: number;
    hsiTp10?: number;
  }> {
    try {
      const runningTrackers = this.trackerService.getRunningTrackerNames();
      const isMuseRunning = runningTrackers.includes('MuseTracker');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      const isConnected = !!tracker?.isDeviceConnected?.();

      if (!isMuseRunning || !isConnected) {
        return {
          isRunning: isMuseRunning,
          connected: false,
          qualityUpdatedAtMs: null,
          signalQuality: null
        };
      }

      const museService = new MuseTrackerService();
      const latestMetadata = await museService.getLatestMetadata();
      const liveQuality = tracker?.getLiveQualitySnapshot?.();

      const pickFinite = (...values: Array<number | null | undefined>): number | undefined => {
        for (const value of values) {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
          }
        }
        return undefined;
      };

      const signalQuality = pickFinite(liveQuality?.signalQuality, latestMetadata?.signalQuality);
      const hsiTp9 = pickFinite(liveQuality?.hsiTp9, latestMetadata?.hsiTp9);
      const hsiAf7 = pickFinite(liveQuality?.hsiAf7, latestMetadata?.hsiAf7);
      const hsiAf8 = pickFinite(liveQuality?.hsiAf8, latestMetadata?.hsiAf8);
      const hsiTp10 = pickFinite(liveQuality?.hsiTp10, latestMetadata?.hsiTp10);

      const qualityUpdatedAtMs =
        (typeof liveQuality?.updatedAtMs === 'number' && Number.isFinite(liveQuality.updatedAtMs)
          ? liveQuality.updatedAtMs
          : undefined) ??
        (() => {
          if (!latestMetadata?.timestamp) {
            return undefined;
          }
          const ts = new Date(latestMetadata.timestamp).getTime();
          return Number.isFinite(ts) ? ts : undefined;
        })() ??
        null;

      return {
        isRunning: true,
        connected: true,
        qualityUpdatedAtMs,
        signalQuality: signalQuality ?? null,
        hsiTp9,
        hsiAf7,
        hsiAf8,
        hsiTp10
      };
    } catch (error) {
      LOG.error('Error getting Muse connection health', error);
      return {
        isRunning: false,
        connected: false,
        qualityUpdatedAtMs: null,
        signalQuality: null
      };
    }
  }

  private async getMuseSummaryMetrics(): Promise<{
    totalDataPoints: number;
    trackedMinutes: number;
    averageSignalQuality: number;
  }> {
    try {
      const museService = new MuseTrackerService();
      await this.refreshMuseStatusMetrics(museService);

      const latestMetadata = await museService.getLatestMetadata();
      const avgQuality =
        typeof latestMetadata?.signalQuality === 'number' &&
        Number.isFinite(latestMetadata.signalQuality)
          ? latestMetadata.signalQuality
          : 0;

      return {
        totalDataPoints: this.museStatusMetrics.totalDataPoints,
        trackedMinutes: this.museStatusMetrics.trackedMinutes,
        averageSignalQuality: avgQuality
      };
    } catch (error) {
      LOG.error('Error getting Muse summary metrics', error);
      return {
        totalDataPoints: 0,
        trackedMinutes: 0,
        averageSignalQuality: 0
      };
    }
  }

  private async startMuseTracker(): Promise<void> {
    try {
      LOG.info('Starting Muse Tracker from IPC');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      if (!tracker) {
        throw new Error('Muse tracker not available');
      }

      await this.trackerService.startTracker('MuseTracker');
    } catch (error) {
      LOG.error('Error starting Muse tracker', error);
      throw error;
    }
  }

  private async stopMuseTracker(): Promise<void> {
    try {
      LOG.info('Stopping Muse Tracker from IPC');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      if (!tracker) {
        throw new Error('Muse tracker not available');
      }

      await this.trackerService.stopTracker('MuseTracker');
    } catch (error) {
      LOG.error('Error stopping Muse tracker', error);
      throw error;
    }
  }

  private async getMuseDataForExport(): Promise<{
    data: Array<{
      id: number;
      timestamp: Date;
      channel1_TP9: number;
      channel2_AF7: number;
      channel3_AF8: number;
      channel4_TP10: number;
    }>;
    totalDataPoints: number;
    previewLimit: number;
  }> {
    try {
      const museService = new MuseTrackerService();
      const previewLimit = 5000;
      const totalRows = await MuseRawEegEntity.getRepository().query(
        'SELECT COALESCE(MAX(id), 0) AS max_id FROM muse_raw_eeg'
      );
      const totalDataPoints = Number(totalRows?.[0]?.max_id ?? 0);
      const previewData = await museService.getRawEegDataForExport(previewLimit);

      return {
        data: previewData.map((d) => ({
          id: d.id,
          timestamp: d.timestamp,
          channel1_TP9: d.tp9,
          channel2_AF7: d.af7,
          channel3_AF8: d.af8,
          channel4_TP10: d.tp10
        })),
        totalDataPoints: Number.isFinite(totalDataPoints) ? totalDataPoints : 0,
        previewLimit
      };
    } catch (error) {
      LOG.error('Error getting Muse data for export', error);
      return {
        data: [],
        totalDataPoints: 0,
        previewLimit: 5000
      };
    }
  }

  private async getMuseOpticsForExport(): Promise<{
    data: Array<{ id: number; timestamp: Date; ch0: number; ch1: number; ch2: number; ch3: number }>;
    totalDataPoints: number;
  }> {
    try {
      const previewLimit = 100;
      const totalRows = await MuseRawOpticsEntity.getRepository().query(
        'SELECT COALESCE(MAX(id), 0) AS max_id FROM muse_raw_optics'
      );
      const totalDataPoints = Number(totalRows?.[0]?.max_id ?? 0);

      const recent = await MuseRawOpticsEntity.find({
        order: { timestamp: 'DESC' },
        take: previewLimit
      });
      const previewData = recent.reverse();

      return {
        data: previewData.map((d) => ({
          id: d.id,
          timestamp: d.timestamp,
          ch0: d.ch0,
          ch1: d.ch1,
          ch2: d.ch2,
          ch3: d.ch3
        })),
        totalDataPoints: Number.isFinite(totalDataPoints) ? totalDataPoints : 0
      };
    } catch (error) {
      LOG.error('Error getting Muse optics data for export', error);
      return {
        data: [],
        totalDataPoints: 0
      };
    }
  }

  private async getDiscoveredDevices(): Promise<any[]> {
    try {
      const museService = new MuseTrackerService();
      // Note: This requires MuseTracker to be running to discover devices
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      if (tracker && tracker.getDiscoveredDevices) {
        return tracker.getDiscoveredDevices();
      }
      return [];
    } catch (error) {
      LOG.error('Error getting discovered devices', error);
      return [];
    }
  }

  private async connectToDevice(macAddress: string): Promise<void> {
    try {
      LOG.info(`IPC: Connecting to device ${macAddress}`);
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      if (tracker && tracker.connectToDevice) {
        await tracker.connectToDevice(macAddress);
      } else {
        throw new Error('Muse tracker not available');
      }
    } catch (error) {
      LOG.error(`Error connecting to device ${macAddress}`, error);
      throw error;
    }
  }

  private async disconnectDevice(): Promise<void> {
    try {
      LOG.info('IPC: Disconnecting from device');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      if (tracker && tracker.disconnectDevice) {
        await tracker.disconnectDevice();
      }
    } catch (error) {
      LOG.error('Error disconnecting device', error);
      throw error;
    }
  }

}
