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
import path from 'path';
import type { NBackTaskBlockDto } from '../../shared/dto/NBackTaskBlockDto';
import { NBackTaskBlockEntity } from '../main/entities/NBackTaskBlockEntity';

const LOG = getMainLogger('IpcHandler');

export class IpcHandler {
  private actions: any;
  private readonly windowService: WindowService;
  private readonly trackerService: TrackerService;
  private readonly MUSE_STATUS_METRICS_REFRESH_MS = 30000;
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

  public async init(): Promise<void> {
    this.actions = {
      openLogs: this.openLogs,
      openCollectedData: this.openCollected,
      getWorkHours: this.getWorkHours,
      setWorkHours: this.setWorkHours,
      setSettingsProp: this.setSettingsProp,
      getSettings: this.getSettings,
      createExperienceSample: this.createExperienceSample,
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
      startAllTrackers: this.startAllTrackers,
      triggerPermissionCheckAccessibility: this.triggerPermissionCheckAccessibility,
      triggerPermissionCheckScreenRecording: this.triggerPermissionCheckScreenRecording,
      'muse:get-tracker-status': this.getMuseTrackerStatus,
      'muse:start-tracker': this.startMuseTracker,
      'muse:stop-tracker': this.stopMuseTracker,
      'muse:get-data-for-export': this.getMuseDataForExport,
      'muse:get-discovered-devices': this.getDiscoveredDevices,
      'muse:connect-device': this.connectToDevice,
      'muse:disconnect-device': this.disconnectDevice,
      'muse:run-diagnostics': this.runMuseDiagnostics
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
    question1: string,
    responseOptions1: string,
    question2: string,
    responseOptions2: string,
    scale: number,
    response1?: number,
    response2?: number,
    skipped: boolean = false
  ) {
    await this.experienceSamplingService.createExperienceSample(
      promptedAt,
      question1,
      responseOptions1,
      question2,
      responseOptions2,
      scale,
      response1,
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
  }

  private async setSettingsProp(prop: string, value: any): Promise<void> {
    const settings: Settings = await Settings.findOne({ where: { onlyOneEntityShouldExist: 1 } });
    settings[prop] = value;
    await settings.save();

    try {
      await this.windowService.updateTray();
    } catch (e) {
      LOG.warn('Failed to update tray after settings change', e);
    }
  }

  private async getSettings(): Promise<Settings> {
    const settings: Settings = await Settings.findOne({ where: { onlyOneEntityShouldExist: 1 } });
    if (!settings) {
      throw new Error('Settings not found');
    }
    return settings;
  }

  private async getStudyInfo(): Promise<StudyInfoDto> {
    const settings: Settings = await Settings.findOne({ where: { onlyOneEntityShouldExist: 1 } });

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
      const [totalDataPoints, trackedMinutes] = await Promise.all([
        MuseRawEegEntity.count(),
        museService.getRawEegTrackedMinutes()
      ]);

      this.museStatusMetrics = {
        lastRefreshedAt: Date.now(),
        totalDataPoints,
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
    raw: Array<{ id: number; timestamp: Date; tp9: number; af7: number; af8: number; tp10: number }>,
    sampleIntervalMs: number
  ): Array<{ id: number; timestamp: Date; tp9: number; af7: number; af8: number; tp10: number }> {
    if (raw.length <= 1) {
      return raw;
    }

    const sorted = [...raw].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const buckets = new Map<number, (typeof sorted)[number]>();
    for (const sample of sorted) {
      const ts = new Date(sample.timestamp).getTime();
      const bucket = Math.floor(ts / sampleIntervalMs) * sampleIntervalMs;
      // Keep latest sample in each 500ms bucket.
      buckets.set(bucket, sample);
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

      // Pull a recent raw window and downsample to 500ms excerpts for UI responsiveness.
      // Non-EEG tabs request a lighter dataset to reduce CPU/IO load.
      const rawWindowSize = includeDenseData ? 10000 : 800;
      const museService = new MuseTrackerService();
      const recentRawData = await museService.getMostRecentRawEegData(rawWindowSize);
      const latestData = this.downsampleRawEegForUi(recentRawData, sampleIntervalMs);
      const latestMetadata = await museService.getLatestMetadata();

      // Refresh heavy aggregate metrics only occasionally to keep UI polling smooth
      // even when the EEG table grows large.
      await this.refreshMuseStatusMetrics(museService);

      // Get connected device (single device) using live tracker state when available
      let connectedDevice = null;
      const isConnected = !!tracker?.isDeviceConnected?.();
      if (isConnected) {
        const connectedInfo = tracker?.getConnectedDevice?.();
        connectedDevice = {
          name: connectedInfo?.name || 'Unknown',
          signalQuality: latestMetadata?.signalQuality ?? null,
          battery: tracker?.getBatteryLevel?.() ?? latestMetadata?.batteryLevel ?? 0
        };
      }

      let avgQuality = 0;
      const qualityValues = [latestMetadata?.signalQuality].filter(
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
        uiSampleIntervalMs: sampleIntervalMs,
        latestData: latestData.map((d) => ({
          id: d.id,
          timestamp: d.timestamp,
          channel1_TP9: d.tp9,
          channel2_AF7: d.af7,
          channel3_AF8: d.af8,
          channel4_TP10: d.tp10,
          batteryLevel: latestMetadata?.batteryLevel,
          signalQuality: latestMetadata?.signalQuality,
          hsiTp9: latestMetadata?.hsiTp9,
          hsiAf7: latestMetadata?.hsiAf7,
          hsiAf8: latestMetadata?.hsiAf8,
          hsiTp10: latestMetadata?.hsiTp10,
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
      const [previewData, totalDataPoints] = await Promise.all([
        museService.getRawEegDataForExport(previewLimit),
        MuseRawEegEntity.count()
      ]);

      return {
        data: previewData.map((d) => ({
          id: d.id,
          timestamp: d.timestamp,
          channel1_TP9: d.tp9,
          channel2_AF7: d.af7,
          channel3_AF8: d.af8,
          channel4_TP10: d.tp10
        })),
        totalDataPoints,
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

  private async runMuseDiagnostics(): Promise<void> {
    try {
      LOG.info('IPC: Running Muse diagnostics');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      if (tracker && tracker.runDiagnostics) {
        tracker.runDiagnostics();
        LOG.info('Diagnostics completed - check main process logs');
      } else {
        LOG.warn('Muse tracker not available for diagnostics');
      }
    } catch (error) {
      LOG.error('Error running diagnostics', error);
      throw error;
    }
  }
}
