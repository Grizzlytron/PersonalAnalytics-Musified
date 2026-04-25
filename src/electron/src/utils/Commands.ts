import StudyInfoDto from '../../shared/dto/StudyInfoDto';
import { DataExportType } from '../../shared/DataExportType.enum';
import { DataExportFormat } from '../../shared/DataExportFormat.enum';
import UserInputDto from '../../shared/dto/UserInputDto';
import WindowActivityDto from '../../shared/dto/WindowActivityDto';
import ExperienceSamplingDto from '../../shared/dto/ExperienceSamplingDto';
import { WorkHoursDto } from '../../shared/dto/WorkHoursDto';
import { Settings } from 'electron/main';
import type { NBackTaskBlockDto } from '../../shared/dto/NBackTaskBlockDto';
import type { ExperienceSamplingAnswerType } from '../../shared/StudyConfiguration';

type Commands = {
  createExperienceSample: (
    promptedAt: Date,
    question: string,
    answerType: ExperienceSamplingAnswerType,
    responseOptions: string | null,
    scale: number | null,
    response?: string,
    question2?: string | null,
    answerType2?: ExperienceSamplingAnswerType | null,
    responseOptions2?: string | null,
    scale2?: number | null,
    response2?: string,
    skipped?: boolean
  ) => Promise<void>;
  resizeExperienceSamplingWindow: (height: number) => void;
  closeExperienceSamplingWindow: (skippedExperienceSampling: boolean) => void;
  openNBackWindow: () => Promise<void>;
  closeNBackWindow: (source?: string) => void;
  setNBackSessionContext: (context: {
    sessionId?: string;
    workflowState?: string;
    currentTaskIndex?: number;
    currentLevel?: string;
    randomizedLevelOrder?: string[];
    remainingLevels?: string[];
    abandoned?: boolean;
  }) => void;
  closeOnboardingWindow: () => void;
  closeDataExportWindow: () => void;
  saveNBackTaskBlock: (payload: NBackTaskBlockDto) => Promise<void>;
  getStudyInfo: () => Promise<StudyInfoDto>;
  getWorkHours: () => Promise<WorkHoursDto>;
  setWorkHours: (schedule: WorkHoursDto) => Promise<void>;
  setSettingsProp: (prop: string, value: any) => Promise<void>;
  getSettings: () => Promise<Settings>;
  openLogs: () => void;
  openCollectedData: () => void;
  getMostRecentExperienceSamplingDtos(itemCount: number): Promise<ExperienceSamplingDto[]>;
  getMostRecentUserInputDtos(itemCount: number): Promise<UserInputDto[]>;
  getMostRecentWindowActivityDtos(itemCount: number): Promise<WindowActivityDto[]>;
  obfuscateWindowActivityDtosById(ids: string[]): Promise<WindowActivityDto[]>;
  startDataExport: (
    windowActivityExportType: DataExportType,
    userInputExportType: DataExportType,
    obfuscationTerms: string[],
    encryptData: boolean,
    exportFormat: DataExportFormat,
    exportDdlProjectName?: string
  ) => Promise<{ fullPath: string; fileName: string }>;
  revealItemInFolder: (path: string) => Promise<void>;
  openUploadUrl: () => void;
  showDataExportError: (errorMessage?: string) => void;
  confirmDDLUpload: () => Promise<boolean>;
  startAllTrackers: () => void;
  triggerPermissionCheckAccessibility: (prompt: boolean) => boolean;
  triggerPermissionCheckScreenRecording: () => boolean;
  retrospectionGetActivities: (date: Date) => Promise<any[]>;
  retrospectionLoadLongestTimeActive: (date: Date) => Promise<any>;
  retrospectionGetTopThreeMostActiveApps: (date: Date) => Promise<any[]>;
  openRetrospection: () => Promise<void>;
  closeRetrospectionWindow: () => void;
  'muse:get-tracker-status': (includeDenseData?: boolean) => Promise<{
    isRunning: boolean;
    connectedDevice: {
      name: string;
      signalQuality: number | null;
      battery: number;
    } | null;
    qualityUpdatedAtMs: number | null;
    uiSampleIntervalMs: number;
    latestData: Array<{
      id: number;
      timestamp: Date | string;
      channel1_TP9: number;
      channel2_AF7: number;
      channel3_AF8: number;
      channel4_TP10: number;
      batteryLevel?: number;
      signalQuality?: number;
      hsiTp9?: number;
      hsiAf7?: number;
      hsiAf8?: number;
      hsiTp10?: number;
      connectionState?: string;
    }>;
    totalDataPoints: number;
    trackedMinutes: number;
    averageSignalQuality: number;
  }>;
  'muse:get-connection-health': () => Promise<{
    isRunning: boolean;
    connected: boolean;
    qualityUpdatedAtMs: number | null;
    signalQuality: number | null;
    hsiTp9?: number;
    hsiAf7?: number;
    hsiAf8?: number;
    hsiTp10?: number;
  }>;
  'muse:get-summary-metrics': () => Promise<{
    totalDataPoints: number;
    trackedMinutes: number;
    averageSignalQuality: number;
  }>;
  'muse:start-tracker': () => Promise<void>;
  'muse:stop-tracker': () => Promise<void>;
  'muse:get-data-for-export': () => Promise<{
    data: Array<{
      id: number;
      timestamp: Date | string;
      channel1_TP9: number;
      channel2_AF7: number;
      channel3_AF8: number;
      channel4_TP10: number;
    }>;
    totalDataPoints: number;
    previewLimit: number;
  }>;
  'muse:get-optics-for-export': () => Promise<{
    data: Array<{
      id: number;
      timestamp: Date | string;
      ch0: number;
      ch1: number;
      ch2: number;
      ch3: number;
    }>;
    totalDataPoints: number;
  }>;
  'muse:get-discovered-devices': () => Promise<
    Array<{ name: string; macAddress: string; rssi: number }>
  >;
  'muse:connect-device': (macAddress: string) => Promise<void>;
  'muse:disconnect-device': () => Promise<void>;
  'muse:run-diagnostics': () => Promise<void>;
};
export default Commands;
