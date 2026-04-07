import StudyInfoDto from '../../shared/dto/StudyInfoDto';
import { DataExportType } from '../../shared/DataExportType.enum';
import { DataExportFormat } from '../../shared/DataExportFormat.enum';
import UserInputDto from '../../shared/dto/UserInputDto';
import WindowActivityDto from '../../shared/dto/WindowActivityDto';
import ExperienceSamplingDto from '../../shared/dto/ExperienceSamplingDto';
import { WorkHoursDto } from '../../shared/dto/WorkHoursDto';
import { Settings } from 'electron/main';
import type { NBackTaskBlockDto } from '../../shared/dto/NBackTaskBlockDto';

type Commands = {
  createExperienceSample: (
    promptedAt: Date,
    question1: string,
    responseOptions1: string,
    question2: string,
    responseOptions2: string,
    scale: number,
    response1?: number,
    response2?: number,
    skipped?: boolean
  ) => Promise<void>;
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
  getWorkHoursEnabled: () => Promise<boolean>;
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
  startAllTrackers: () => void;
  triggerPermissionCheckAccessibility: (prompt: boolean) => boolean;
  triggerPermissionCheckScreenRecording: () => boolean;
  'muse:get-tracker-status': (includeDenseData?: boolean) => Promise<{
    isRunning: boolean;
    connectedDevice: {
      name: string;
      signalQuality: number | null;
      battery: number;
    } | null;
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
  'muse:get-discovered-devices': () => Promise<
    Array<{ name: string; macAddress: string; rssi: number }>
  >;
  'muse:connect-device': (macAddress: string) => Promise<void>;
  'muse:disconnect-device': () => Promise<void>;
  'muse:run-diagnostics': () => Promise<void>;
};
export default Commands;
