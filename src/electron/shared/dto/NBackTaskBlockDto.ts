export type NBackTrialResultDto = {
  trialNumber: number;
  stimulusSquare: number;
  expectedSquare: number | null;
  selectedSquare: number | null;
  responded: boolean;
  isCorrect: boolean;
  pressedKey?: string | null;
  reactionTimeMs?: number | null;
};

export type NBackTaskTimingConfigDto = {
  startDelayMs: number;
  stimulusDurationMs: number;
  responseDurationMs: number;
  totalTrials: number;
};

export type NBackTaskBlockDto = {
  sessionId: string;
  taskId: string;
  withDistractions: boolean;
  startedAt: string;
  completedAt: string;
  completedTrials: number;
  correctResponses: number;
  accuracyPercent: number;
  timingConfig: NBackTaskTimingConfigDto;
  reflectionQuestion1: string;
  reflectionResponse1: number;
  reflectionQuestion2: string;
  reflectionResponse2: number;
  trialResults: NBackTrialResultDto[];
};
