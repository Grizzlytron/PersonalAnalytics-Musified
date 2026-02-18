import StudyInfoDto from '../../shared/dto/StudyInfoDto';
import { DataExportType } from '../../shared/DataExportType.enum';
import { DataExportFormat } from '../../shared/DataExportFormat.enum';
import UserInputDto from '../../shared/dto/UserInputDto';
import WindowActivityDto from '../../shared/dto/WindowActivityDto';
import ExperienceSamplingDto from '../../shared/dto/ExperienceSamplingDto';
import { WorkHoursDto } from '../../shared/dto/WorkHoursDto'
import { Settings } from 'electron/main'

type Commands = {
  createExperienceSample: (
    promptedAt: Date,
    question: string,
    responseOptions: string,
    scale: number,
    response?: number,
    skipped?: boolean
  ) => Promise<void>;
  closeExperienceSamplingWindow: (skippedExperienceSampling: boolean) => void;
  closeOnboardingWindow: () => void;
  closeDataExportWindow: () => void;
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
  'muse:get-tracker-status': () => Promise<{
    isRunning: boolean;
    connectedDevice: { name: string; signalQuality: number; battery: number; heartRate: number } | null;
    latestData: any[];
    totalDataPoints: number;
    averageSignalQuality: number;
  }>;
  'muse:start-tracker': () => Promise<void>;
  'muse:stop-tracker': () => Promise<void>;
  'muse:get-data-for-export': () => Promise<any[]>;
  'muse:get-discovered-devices': () => Promise<Array<{ name: string; macAddress: string; rssi: number }>>;
  'muse:connect-device': (macAddress: string) => Promise<void>;
  'muse:disconnect-device': () => Promise<void>;
  'muse:run-diagnostics': () => Promise<void>;
};
export default Commands;
