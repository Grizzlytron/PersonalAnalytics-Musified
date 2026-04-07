export type NBackTaskMode =
  | '0-back-gamified'
  | '1-back-gamified'
  | '2-back-gamified'
  | '2-back-gamified-distraction'
  | '3-back-gamified';

export type NBackConfig = {
  n: number;
  totalTrials: number;
  startDelayMs: number;
  stimulusDurationMs: number;
  responseDurationMs: number;
  distractionDotCount: number;
};

const nBackConfig: NBackConfig = {
  // Backend-controlled defaults for study sessions.
  n: 2,
  totalTrials: 48,
  startDelayMs: 3000,
  stimulusDurationMs: 500,
  responseDurationMs: 2000,
  distractionDotCount: 18
};

export default nBackConfig;
