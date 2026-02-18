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
import { WorkScheduleService } from 'electron/main/services/WorkScheduleService'
import { WorkHoursDto } from 'shared/dto/WorkHoursDto'
import { MuseEntity } from '../main/entities/MuseEntity';
import path from 'path';

const LOG = getMainLogger('IpcHandler');

export class IpcHandler {
  private actions: any;
  private readonly windowService: WindowService;
  private readonly trackerService: TrackerService;

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
      closeOnboardingWindow: this.closeOnboardingWindow,
      closeDataExportWindow: this.closeDataExportWindow,
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
    question: string,
    responseOptions: string,
    scale: number,
    response: number,
    skipped: boolean = false
  ) {
    await this.experienceSamplingService.createExperienceSample(
      promptedAt,
      question,
      responseOptions,
      scale,
      response,
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

  private closeOnboardingWindow(): void {
    this.windowService.closeOnboardingWindow();
  }

  private closeDataExportWindow(): void {
    this.windowService.closeDataExportWindow();
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
    const message = `Please try again. If the export keeps failing, contact the study team (${studyConfig.contactName}, ${studyConfig.contactEmail}) and send them a screenshot of this error.` 
                      + (errorMessage ? `\n\nError message: ${errorMessage}` : '');
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

  // Muse Tracker IPC Handlers
  private async getMuseTrackerStatus(): Promise<any> {
    try {
      const runningTrackers = this.trackerService.getRunningTrackerNames();
      const isMuseRunning = runningTrackers.includes('MuseTracker');
      const tracker = this.trackerService.getTracker('MuseTracker') as any;
      
      // Get latest data (limit to 50 for performance)
      const museService = new MuseTrackerService();
      const latestData = await museService.getMostRecentMuseData(50);
      
      // Get total count efficiently
      const totalDataPoints = await MuseEntity.count();
      
      // Get connected device (single device) using live tracker state when available
      let connectedDevice = null;
      const isConnected = !!tracker?.isDeviceConnected?.();
      if (isConnected) {
        const latestRecord = latestData.length > 0 ? latestData[0] : null;
        const connectedInfo = tracker?.getConnectedDevice?.();
        const liveBattery = tracker?.getBatteryLevel?.();
        // Prefer live battery, but also accept 0 as valid (fully discharged), fall back to DB if undefined/null
        const batteryLevel = liveBattery !== undefined && liveBattery !== null ? liveBattery : (latestRecord?.batteryLevel ?? 0);
        const liveHeartRate = tracker?.getHeartRate?.() ?? 0;
        connectedDevice = {
          name: connectedInfo?.name || latestRecord?.deviceName || 'Unknown',
          signalQuality: latestRecord?.signalQuality || 0,
          battery: batteryLevel,
          heartRate: liveHeartRate
        };
      }
      
      // Calculate average signal quality — only meaningful when a device is connected
      let avgQuality = 0;
      if (connectedDevice && latestData.length > 0) {
        const qualitySum = latestData.reduce((sum, d) => sum + (d.signalQuality || 0), 0);
        avgQuality = Math.round(qualitySum / latestData.length);
      }

      return {
        isRunning: isMuseRunning,
        connectedDevice: connectedDevice,
        latestData: latestData.map(d => ({
          id: d.id,
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          timestamp: d.timestamp,
          channel1_TP9: d.channel1_TP9,
          channel2_AF7: d.channel2_AF7,
          channel3_AF8: d.channel3_AF8,
          channel4_TP10: d.channel4_TP10,
          ppg: d.ppg,
          batteryLevel: d.batteryLevel,
          signalQuality: d.signalQuality,
          connectionState: d.connectionState
        })),
        totalDataPoints: totalDataPoints,
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
      await this.trackerService.startAllTrackers();
    } catch (error) {
      LOG.error('Error starting Muse tracker', error);
      throw error;
    }
  }

  private async stopMuseTracker(): Promise<void> {
    try {
      LOG.info('Stopping Muse Tracker from IPC');
      await this.trackerService.stopAllTrackers();
    } catch (error) {
      LOG.error('Error stopping Muse tracker', error);
      throw error;
    }
  }

  private async getMuseDataForExport(): Promise<any[]> {
    try {
      const allData = await MuseEntity.find({
        order: { timestamp: 'ASC' }
      });
      
      return allData.map(d => ({
        id: d.id,
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        timestamp: d.timestamp,
        channel1_TP9: d.channel1_TP9,
        channel2_AF7: d.channel2_AF7,
        channel3_AF8: d.channel3_AF8,
        channel4_TP10: d.channel4_TP10,
        ppg: d.ppg,
        batteryLevel: d.batteryLevel,
        signalQuality: d.signalQuality,
        connectionState: d.connectionState
      }));
    } catch (error) {
      LOG.error('Error getting Muse data for export', error);
      return [];
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