<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import nBackConfig from '../../shared/nBack.config';
import studyConfig from '../../shared/study.config';
import type { NBackTaskDefinition } from '../../shared/StudyConfiguration';
import type { NBackTaskBlockDto } from '../../shared/dto/NBackTaskBlockDto';
import { NBackGridCellIndex, useNBackTask } from '../modules/nback/useNBackTask';
import typedIpcRenderer from '../utils/typedIpcRenderer';

type WorkflowState = 'setup' | 'task-ready' | 'task-running' | 'reflection' | 'completed';
type SpatialTaskInstance = ReturnType<typeof useNBackTask>;
type MuseConnectionState = 'good' | 'warning' | 'bad' | 'disconnected';

type DistractionDot = {
  id: number;
  sizePx: number;
  topPercent: number;
  leftPercent: number;
  durationMs: number;
  delayMs: number;
  flickerDurationMs: number;
  flickerDelayMs: number;
  driftX: number;
  driftY: number;
  opacity: number;
};

type MeteoriteEffect = {
  id: number;
  topPercent: number;
  leftPercent: number;
  sizePx: number;
  travelX: number;
  travelY: number;
  trailAngleDeg: number;
  rotationDeg: number;
  durationMs: number;
  delayMs: number;
  intensity: number;
};

const meteoriteCount = 11;

const rawInterfaceConfig = studyConfig.nBackInterface;

if (!rawInterfaceConfig) {
  throw new Error('studyConfig.nBackInterface is required for NBackView.');
}

if (!rawInterfaceConfig.tasks?.length) {
  throw new Error('studyConfig.nBackInterface.tasks must contain at least one task.');
}

if (!rawInterfaceConfig.reflectionQuestions || rawInterfaceConfig.reflectionQuestions.length < 2) {
  throw new Error(
    'studyConfig.nBackInterface.reflectionQuestions must contain at least two questions.'
  );
}

if (typeof rawInterfaceConfig.distractionDotCount !== 'number') {
  throw new Error('studyConfig.nBackInterface.distractionDotCount is required.');
}

if (typeof rawInterfaceConfig.scale !== 'number') {
  throw new Error('studyConfig.nBackInterface.scale is required.');
}

if (typeof rawInterfaceConfig.randomizeTasksAfterFirstLevel !== 'boolean') {
  throw new Error('studyConfig.nBackInterface.randomizeTasksAfterFirstLevel is required.');
}

const interfaceConfig = rawInterfaceConfig;
const baseTaskSequence: NBackTaskDefinition[] = interfaceConfig.tasks;
const shouldRandomizeTasksAfterFirstLevel = interfaceConfig.randomizeTasksAfterFirstLevel;
const reflectionQuestions = interfaceConfig.reflectionQuestions.slice(0, 2);
const reflectionScale: number = interfaceConfig.scale as number;
const distractionDotCount: number = interfaceConfig.distractionDotCount as number;

function cloneTaskDefinition(taskDef: NBackTaskDefinition): NBackTaskDefinition {
  return { ...taskDef };
}

function shuffleTaskDefinitions(taskDefs: NBackTaskDefinition[]): NBackTaskDefinition[] {
  const shuffled = [...taskDefs];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function buildTaskSequence(): NBackTaskDefinition[] {
  const clonedBaseSequence = baseTaskSequence.map(cloneTaskDefinition);
  if (!shouldRandomizeTasksAfterFirstLevel || clonedBaseSequence.length <= 1) {
    return clonedBaseSequence;
  }

  const [firstTask, ...remainingTasks] = clonedBaseSequence;
  return [firstTask, ...shuffleTaskDefinitions(remainingTasks)];
}

const taskSequence = ref<NBackTaskDefinition[]>(buildTaskSequence());

const centerSquare = 4;
const squareOrder: NBackGridCellIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const workflowState = ref<WorkflowState>('setup');
const sessionId = ref('');
const currentTaskIndex = ref(0);
const currentReflectionIndex = ref(0);
const reflectionResponses = ref<number[]>([]);
const activeTask = shallowRef<SpatialTaskInstance | null>(null);
const saveError = ref<string | null>(null);
const isSaving = ref(false);
const museConnectionState = ref<MuseConnectionState>('disconnected');

const museStatusRefreshMs = 6000;
let museStatusInterval: ReturnType<typeof setInterval> | null = null;
let museStatusRequestInFlight = false;

let stopTaskWatcher: (() => void) | null = null;

function createSessionId(): string {
  return `nback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDistractionDots(count: number): DistractionDot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    sizePx: 6 + Math.floor(Math.random() * 16),
    topPercent: Math.floor(Math.random() * 100),
    leftPercent: Math.floor(Math.random() * 100),
    durationMs: 900 + Math.floor(Math.random() * 1200),
    delayMs: Math.floor(Math.random() * 700),
    flickerDurationMs: 260 + Math.floor(Math.random() * 480),
    flickerDelayMs: Math.floor(Math.random() * 700),
    driftX: -85 + Math.floor(Math.random() * 170),
    driftY: -85 + Math.floor(Math.random() * 170),
    opacity: 0.2 + Math.random() * 0.5
  }));
}

const meteorMinTravelDistancePx = 760;
const meteorMaxTravelDistancePx = 1280;
// Only 60% of the animation duration is actual travel (keyframes 18%→78%).
// So raw duration = distance / speed, then clamped. Target effective travel
// speed is ~0.3 px/ms → raw speed = 0.3 * 0.6 ≈ 0.18 px/ms.
const meteorTargetSpeedPxPerMs = 0.18;
const meteorSpeedVariance = 0.05;
const meteorMinDurationMs = 3000;
const meteorMaxDurationMs = 4500;

function createMeteorMotionProfile(): { travelX: number; travelY: number; trailAngleDeg: number; durationMs: number } {
  const angleRad = Math.random() * Math.PI * 2;
  const distancePx =
    meteorMinTravelDistancePx +
    Math.random() * (meteorMaxTravelDistancePx - meteorMinTravelDistancePx);
  const effectiveSpeedPxPerMs =
    meteorTargetSpeedPxPerMs *
    (1 - meteorSpeedVariance + Math.random() * meteorSpeedVariance * 2);

  const travelX = Math.round(Math.cos(angleRad) * distancePx);
  const travelY = Math.round(Math.sin(angleRad) * distancePx * 0.72);
  const rawDurationMs = Math.round(distancePx / effectiveSpeedPxPerMs);
  const durationMs = Math.min(meteorMaxDurationMs, Math.max(meteorMinDurationMs, rawDurationMs));
  // Trail points opposite to travel direction.
  const trailAngleDeg = Math.round(Math.atan2(travelY, travelX) * (180 / Math.PI)) + 180;

  return {
    travelX,
    travelY,
    trailAngleDeg,
    durationMs
  };
}

function createMeteorites(count: number): MeteoriteEffect[] {
  return Array.from({ length: count }, (_, index) => {
    const motion = createMeteorMotionProfile();

    return {
      id: index,
      topPercent: -26 + Math.floor(Math.random() * 152),
      leftPercent: -40 + Math.floor(Math.random() * 182),
      sizePx: 26 + Math.floor(Math.random() * 54),
      travelX: motion.travelX,
      travelY: motion.travelY,
      trailAngleDeg: motion.trailAngleDeg,
      rotationDeg: -36 + Math.floor(Math.random() * 72),
      durationMs: motion.durationMs,
      delayMs: Math.floor(Math.random() * 2600),
      intensity: 0.55 + Math.random() * 0.4
    };
  });
}

function rerollMeteoriteTrajectory(meteorId: number): void {
  const meteorIndex = meteorites.value.findIndex((meteor) => meteor.id === meteorId);
  if (meteorIndex < 0) {
    return;
  }

  const currentMeteor = meteorites.value[meteorIndex];
  const motion = createMeteorMotionProfile();

  meteorites.value[meteorIndex] = {
    ...currentMeteor,
    topPercent: -26 + Math.floor(Math.random() * 152),
    leftPercent: -40 + Math.floor(Math.random() * 182),
    travelX: motion.travelX,
    travelY: motion.travelY,
    trailAngleDeg: motion.trailAngleDeg,
    rotationDeg: -36 + Math.floor(Math.random() * 72),
    durationMs: motion.durationMs,
    intensity: 0.55 + Math.random() * 0.4
  };
}

const distractionDots = ref(createDistractionDots(distractionDotCount));
const meteorites = ref(createMeteorites(meteoriteCount));

const currentTask = computed(() => taskSequence.value[currentTaskIndex.value] ?? null);
const currentTaskTotalTrials = computed(
  () => currentTask.value?.totalTrials ?? nBackConfig.totalTrials
);
const reflectionScaleValues = computed(() =>
  Array.from({ length: reflectionScale }, (_entry, index) => index + 1)
);
const activeReflectionQuestion = computed(
  () => reflectionQuestions[currentReflectionIndex.value] ?? null
);
const randomizedLevelOrder = computed(() =>
  taskSequence.value.map((taskDef, index) => getWorkflowLevelLabel(taskDef, index))
);
const remainingLevelOrder = computed(() => {
  if (workflowState.value === 'completed' || workflowState.value === 'setup') {
    return [];
  }

  const nextTaskIndex = Math.min(currentTaskIndex.value + 1, randomizedLevelOrder.value.length);
  return randomizedLevelOrder.value.slice(nextTaskIndex);
});
const shouldShowMuseWarning = computed(() => museIndicatorText.value !== '');

function resolveTaskId(taskDef: NBackTaskDefinition): string {
  if (taskDef.n === 0) {
    return 'task-0-back';
  }

  if (taskDef.n === 1) {
    return 'task-1-back';
  }

  if (taskDef.n === 2 && taskDef.withDistractions === true) {
    return 'task-2-back-distraction';
  }

  if (taskDef.n === 2) {
    return 'task-2-back';
  }

  if (taskDef.n === 3) {
    return 'task-3-back';
  }

  return `task-${taskDef.n}-back${taskDef.withDistractions === true ? '-distraction' : ''}`;
}

function getWorkflowLevelLabel(taskDef: NBackTaskDefinition | null, fallbackIndex: number): string {
  if (!taskDef) {
    return 'Level';
  }

  if (taskDef.n === 0) {
    return 'Level 1';
  }

  if (taskDef.n === 1) {
    return 'Level 2';
  }

  if (taskDef.n === 2 && taskDef.withDistractions !== true) {
    return 'Level 3';
  }

  if (taskDef.n === 2 && taskDef.withDistractions === true) {
    return 'Level 4';
  }

  if (taskDef.n === 3) {
    return 'Level 5';
  }

  return `Level ${fallbackIndex + 1}`;
}

function getLevelGoalOverview(taskDef: NBackTaskDefinition | null): string {
  if (!taskDef) {
    return 'Focus on the grid and press J only when the level rule is satisfied.';
  }

  if (taskDef.n === 0) {
    return 'Press J when the highlighted gate appears in the top-left position. Do not press for any other position.';
  }

  if (taskDef.n === 1) {
    return 'Press J when the current gate matches the immediately previous gate.';
  }

  if (taskDef.n === 2 && taskDef.withDistractions !== true) {
    return 'Press J when the current gate matches the gate from 2 trials ago.';
  }

  if (taskDef.n === 2 && taskDef.withDistractions === true) {
    return 'Press J when the current gate matches the gate from 2 trials ago, while ignoring star flickers and meteorites in the background.';
  }

  if (taskDef.n === 3) {
    return 'Press J when the current gate matches the gate from 3 trials ago.';
  }

  return "Press J only when the current gate matches this level's N-back rule.";
}

const currentLevelGoalOverview = computed(() => getLevelGoalOverview(currentTask.value));
let feedbackAudioContext: AudioContext | null = null;
const feedbackNoiseBufferCache = new Map<number, AudioBuffer>();

function createNoiseBuffer(context: AudioContext, durationSeconds: number): AudioBuffer {
  const sampleLength = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, sampleLength, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < sampleLength; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function getFeedbackNoiseBuffer(context: AudioContext, durationSeconds: number): AudioBuffer {
  const roundedDuration = Number(durationSeconds.toFixed(3));
  const cachedBuffer = feedbackNoiseBufferCache.get(roundedDuration);
  if (cachedBuffer) {
    return cachedBuffer;
  }

  const createdBuffer = createNoiseBuffer(context, roundedDuration);
  feedbackNoiseBufferCache.set(roundedDuration, createdBuffer);
  return createdBuffer;
}

async function getFeedbackAudioContext(): Promise<AudioContext | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const audioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!audioContextCtor) {
    return null;
  }

  if (!feedbackAudioContext || feedbackAudioContext.state === 'closed') {
    feedbackAudioContext = new audioContextCtor();
  }

  if (feedbackAudioContext.state === 'suspended') {
    try {
      await feedbackAudioContext.resume();
    } catch {
      return null;
    }
  }

  return feedbackAudioContext;
}

async function warmupFeedbackAudio() {
  const context = await getFeedbackAudioContext();
  if (!context) {
    return;
  }

  // Prime the audio graph so first scored input does not lag.
  const now = context.currentTime;
  const silentGain = context.createGain();
  silentGain.gain.setValueAtTime(0.0001, now);
  silentGain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(440, now);
  oscillator.connect(silentGain);
  oscillator.start(now);
  oscillator.stop(now + 0.01);

  getFeedbackNoiseBuffer(context, 0.37);
  getFeedbackNoiseBuffer(context, 0.18);
}

function createFeedbackLimiter(context: AudioContext, now: number): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-18, now);
  limiter.knee.setValueAtTime(10, now);
  limiter.ratio.setValueAtTime(9, now);
  limiter.attack.setValueAtTime(0.003, now);
  limiter.release.setValueAtTime(0.09, now);
  return limiter;
}

function playAchievementNote(
  context: AudioContext,
  destination: AudioNode,
  noteStart: number,
  noteDurationSeconds: number,
  frequencyHz: number,
  peakGain: number
) {
  const noteEnd = noteStart + noteDurationSeconds;
  const oscillator = context.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequencyHz, noteStart);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, noteStart);
  gain.gain.exponentialRampToValueAtTime(peakGain, noteStart + 0.016);
  gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

  oscillator.connect(gain);
  gain.connect(destination);

  oscillator.start(noteStart);
  oscillator.stop(noteEnd);
}

function playPositiveAchievementSound(context: AudioContext) {
  const now = context.currentTime;
  const durationSeconds = 0.37;
  const endTime = now + durationSeconds;

  const masterGain = context.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.exponentialRampToValueAtTime(0.27, now + 0.028);
  masterGain.gain.exponentialRampToValueAtTime(0.07, now + 0.2);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  const panner = context.createStereoPanner();
  panner.pan.setValueAtTime(-0.12, now);
  panner.pan.linearRampToValueAtTime(0.12, endTime);

  const limiter = createFeedbackLimiter(context, now);

  const arpeggio = [
    { frequencyHz: 523.25, startOffset: 0.0, durationSeconds: 0.16, peakGain: 0.14 },
    { frequencyHz: 659.25, startOffset: 0.055, durationSeconds: 0.16, peakGain: 0.13 },
    { frequencyHz: 783.99, startOffset: 0.11, durationSeconds: 0.17, peakGain: 0.125 },
    { frequencyHz: 1046.5, startOffset: 0.165, durationSeconds: 0.2, peakGain: 0.135 }
  ];

  for (const note of arpeggio) {
    playAchievementNote(
      context,
      panner,
      now + note.startOffset,
      note.durationSeconds,
      note.frequencyHz,
      note.peakGain
    );
  }

  panner.connect(limiter);
  limiter.connect(masterGain);
  masterGain.connect(context.destination);
}

function playClangingSound(context: AudioContext) {
  const now = context.currentTime;
  const durationSeconds = 0.18;

  const clangPrimary = context.createOscillator();
  clangPrimary.type = 'triangle';
  clangPrimary.frequency.setValueAtTime(540, now);
  clangPrimary.frequency.exponentialRampToValueAtTime(170, now + durationSeconds);

  const clangPrimaryGain = context.createGain();
  clangPrimaryGain.gain.setValueAtTime(0.0001, now);
  clangPrimaryGain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
  clangPrimaryGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  const clangOvertone = context.createOscillator();
  clangOvertone.type = 'square';
  clangOvertone.frequency.setValueAtTime(1440, now);
  clangOvertone.frequency.exponentialRampToValueAtTime(430, now + durationSeconds);

  const clangOvertoneGain = context.createGain();
  clangOvertoneGain.gain.setValueAtTime(0.0001, now);
  clangOvertoneGain.gain.exponentialRampToValueAtTime(0.038, now + 0.008);
  clangOvertoneGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  const breakNoiseSource = context.createBufferSource();
  breakNoiseSource.buffer = getFeedbackNoiseBuffer(context, durationSeconds);

  const breakNoiseFilter = context.createBiquadFilter();
  breakNoiseFilter.type = 'highpass';
  breakNoiseFilter.frequency.setValueAtTime(1900, now);

  const breakNoiseGain = context.createGain();
  breakNoiseGain.gain.setValueAtTime(0.0001, now);
  breakNoiseGain.gain.exponentialRampToValueAtTime(0.05, now + 0.004);
  breakNoiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

  clangPrimary.connect(clangPrimaryGain);
  clangPrimaryGain.connect(context.destination);

  clangOvertone.connect(clangOvertoneGain);
  clangOvertoneGain.connect(context.destination);

  breakNoiseSource.connect(breakNoiseFilter);
  breakNoiseFilter.connect(breakNoiseGain);
  breakNoiseGain.connect(context.destination);

  clangPrimary.start(now);
  clangPrimary.stop(now + durationSeconds);
  clangOvertone.start(now);
  clangOvertone.stop(now + durationSeconds);
  breakNoiseSource.start(now);
  breakNoiseSource.stop(now + durationSeconds);
}

function playFeedbackSound(kind: 'correct' | 'incorrect') {
  void (async () => {
    const context = await getFeedbackAudioContext();
    if (!context) {
      return;
    }

    if (kind === 'correct') {
      playPositiveAchievementSound(context);
      return;
    }

    playClangingSound(context);
  })();
}

watch(
  () => activeTask.value?.lastResult.value,
  (latestResult) => {
    if (!latestResult || latestResult.expectedSquare === null) {
      return;
    }

    const pressedKey = latestResult.pressedKey?.trim().toUpperCase();
    const hasActionButtonPress = latestResult.responded && pressedKey === 'J';

    if (!hasActionButtonPress) {
      return;
    }

    if (latestResult.isCorrect) {
      playFeedbackSound('correct');
    } else {
      playFeedbackSound('incorrect');
    }
  }
);

const completedTrialsDisplay = computed(() => activeTask.value?.completedTrials.value ?? 0);
const progressPercentDisplay = computed(() => activeTask.value?.progressPercent.value ?? 0);
const speedRelevantTrialResults = computed(() =>
  (activeTask.value?.trialResults.value ?? []).filter((trial) => trial.expectedSquare !== null)
);
const speedPercentDisplay = computed(() => {
  if (workflowState.value !== 'task-running') {
    return 50;
  }

  const totalTrialsForLevel = Math.max(1, currentTaskTotalTrials.value);
  const nonEvaluableStartupTrials = Math.max(0, currentTask.value?.n ?? 0);
  const evaluableTrialsForLevel = Math.max(1, totalTrialsForLevel - nonEvaluableStartupTrials);
  const completedTrialCount = speedRelevantTrialResults.value.length;

  if (completedTrialCount === 0) {
    return 50;
  }

  const score = speedRelevantTrialResults.value.reduce((acc, trial) => {
    const isTargetTrial =
      trial.expectedSquare !== null && trial.stimulusSquare === trial.expectedSquare;
    const pressedActionButton = trial.responded && trial.pressedKey?.trim().toUpperCase() === 'J';

    if (isTargetTrial) {
      if (pressedActionButton && trial.isCorrect) {
        return acc + 3;
      }

      return acc - 4;
    }

    if (pressedActionButton) {
      return acc - 4;
    }

    return acc;
  }, 0);
  const stepPerTrial = 50 / evaluableTrialsForLevel;
  return Math.max(0, Math.min(100, 50 + score * stepPerTrial));
});
const showTaskUi = computed(
  () => workflowState.value === 'task-ready' || workflowState.value === 'task-running'
);
const showDistractions = computed(
  () => workflowState.value === 'task-running' && currentTask.value?.withDistractions === true
);
const museIndicatorClass = computed(() => {
  return museConnectionState.value === 'disconnected'
    ? 'muse-indicator-warning'
    : 'muse-indicator-bad';
});
const museIndicatorText = computed(() => {
  if (museConnectionState.value === 'disconnected') {
    return 'No Muse Device Connected';
  }

  if (museConnectionState.value === 'bad') {
    return 'Muse: Bad Connection - Avoid doing any excessive movements.';
  }

  return '';
});

async function refreshMuseConnectionStatus() {
  if (museStatusRequestInFlight) {
    return;
  }

  museStatusRequestInFlight = true;
  try {
    const status = await typedIpcRenderer.invoke('muse:get-connection-health');
    if (!status?.connected) {
      museConnectionState.value = 'disconnected';
      return;
    }

    const hsiValues = [status.hsiTp9, status.hsiAf7, status.hsiAf8, status.hsiTp10].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v)
    );

    if (hsiValues.length > 0) {
      if (hsiValues.every((value) => value <= 1)) {
        museConnectionState.value = 'good';
        return;
      }

      if (hsiValues.some((value) => value === 4)) {
        museConnectionState.value = 'bad';
        return;
      }

      museConnectionState.value = 'good';
      return;
    }

    const scalarQuality = status.signalQuality;
    if (typeof scalarQuality === 'number' && Number.isFinite(scalarQuality)) {
      museConnectionState.value = scalarQuality === 4 ? 'bad' : 'good';
      return;
    }

    museConnectionState.value = 'good';
  } catch {
    museConnectionState.value = 'disconnected';
  } finally {
    museStatusRequestInFlight = false;
  }
}

function startMuseStatusPolling() {
  if (museStatusInterval) {
    clearInterval(museStatusInterval);
    museStatusInterval = null;
  }

  museStatusInterval = setInterval(() => {
    if (workflowState.value !== 'task-ready' && workflowState.value !== 'task-running') {
      return;
    }
    void refreshMuseConnectionStatus();
  }, museStatusRefreshMs);
}

function disposeTask() {
  if (stopTaskWatcher) {
    stopTaskWatcher();
    stopTaskWatcher = null;
  }
  activeTask.value?.dispose();
  activeTask.value = null;
}

function squareClass(square: NBackGridCellIndex): string {
  if (square === centerSquare) {
    return 'square-center';
  }

  if (
    activeTask.value?.phase.value === 'stimulus' &&
    activeTask.value.activeSquare.value === square
  ) {
    return 'square-highlighted';
  }
  return 'square-idle';
}

function createTaskForCurrentBlock(taskDef: NBackTaskDefinition): SpatialTaskInstance {
  return useNBackTask({
    n: taskDef.n,
    totalTrials: taskDef.totalTrials ?? nBackConfig.totalTrials,
    startDelayMs: nBackConfig.startDelayMs,
    stimulusDurationMs: nBackConfig.stimulusDurationMs,
    responseDurationMs: nBackConfig.responseDurationMs,
    sameResponseKey: 'J'
  });
}

function displayTaskTitle(taskDef: NBackTaskDefinition | null): string {
  return getWorkflowLevelLabel(taskDef, currentTaskIndex.value);
}

function prepareCurrentTask() {
  const taskDef = currentTask.value;
  if (!taskDef) {
    workflowState.value = 'completed';
    return;
  }

  disposeTask();
  reflectionResponses.value = [];
  currentReflectionIndex.value = 0;
  saveError.value = null;

  if (taskDef.withDistractions === true) {
    distractionDots.value = createDistractionDots(distractionDotCount);
    meteorites.value = createMeteorites(meteoriteCount);
  }

  activeTask.value = createTaskForCurrentBlock(taskDef);
  stopTaskWatcher = watch(
    () => activeTask.value?.hasFinished.value,
    (hasFinished) => {
      if (hasFinished && workflowState.value === 'task-running') {
        workflowState.value = 'reflection';
      }
    }
  );

  workflowState.value = 'task-ready';
}

function startWorkflow() {
  void warmupFeedbackAudio();
  sessionId.value = createSessionId();
  taskSequence.value = buildTaskSequence();
  currentTaskIndex.value = 0;
  prepareCurrentTask();
}

function startCurrentTask() {
  if (workflowState.value !== 'task-ready' || !activeTask.value) {
    return;
  }

  saveError.value = null;
  workflowState.value = 'task-running';
  activeTask.value.start();
}

async function closeNBackWindowAndReturn() {
  await typedIpcRenderer.invoke('closeNBackWindow', 'renderer-close');
}

function syncNBackSessionContext(): void {
  void typedIpcRenderer
    .invoke('setNBackSessionContext', {
      sessionId: sessionId.value || undefined,
      workflowState: workflowState.value,
      currentTaskIndex: currentTaskIndex.value,
      currentLevel: getWorkflowLevelLabel(currentTask.value, currentTaskIndex.value),
      randomizedLevelOrder: randomizedLevelOrder.value,
      remainingLevels: remainingLevelOrder.value,
      abandoned: workflowState.value !== 'completed'
    })
    .catch(() => undefined);
}

function onKeyDown(event: KeyboardEvent) {
  const pressedKey = event.key.trim().toUpperCase();

  if (workflowState.value === 'task-ready' && pressedKey === 'J') {
    event.preventDefault();
    startCurrentTask();
    return;
  }

  if (workflowState.value !== 'task-running' || !activeTask.value) {
    return;
  }

  activeTask.value.submitKeyboardResponse(event.key);
}

async function persistCurrentTaskBlock(): Promise<boolean> {
  if (!activeTask.value || !currentTask.value || reflectionResponses.value.length < 2) {
    return false;
  }

  const startedAt = activeTask.value.startedAt.value ?? new Date();
  const completedAt = activeTask.value.completedAt.value ?? new Date();
  const reflectionQuestion1 = reflectionQuestions[0];
  const reflectionQuestion2 = reflectionQuestions[1];

  const payload: NBackTaskBlockDto = {
    sessionId: sessionId.value,
    taskId: resolveTaskId(currentTask.value),
    withDistractions: currentTask.value.withDistractions === true,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    completedTrials: activeTask.value.completedTrials.value,
    correctResponses: activeTask.value.correctResponses.value,
    accuracyPercent: Number(activeTask.value.accuracyPercent.value.toFixed(4)),
    timingConfig: {
      startDelayMs: nBackConfig.startDelayMs,
      stimulusDurationMs: nBackConfig.stimulusDurationMs,
      responseDurationMs: nBackConfig.responseDurationMs,
      totalTrials: currentTask.value.totalTrials ?? nBackConfig.totalTrials
    },
    reflectionQuestion1: reflectionQuestion1.text,
    reflectionResponse1: reflectionResponses.value[0],
    reflectionQuestion2: reflectionQuestion2.text,
    reflectionResponse2: reflectionResponses.value[1],
    trialResults: activeTask.value.trialResults.value.map((trial) => ({
      trialNumber: trial.trialNumber,
      stimulusSquare: trial.stimulusSquare,
      expectedSquare: trial.expectedSquare,
      selectedSquare: trial.selectedSquare,
      responded: trial.responded,
      isCorrect: trial.isCorrect,
      pressedKey: trial.pressedKey ?? null,
      reactionTimeMs: trial.reactionTimeMs ?? null
    }))
  };

  isSaving.value = true;
  saveError.value = null;
  try {
    await typedIpcRenderer.invoke('saveNBackTaskBlock', payload);
    return true;
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : 'Saving N-Back task block failed.';
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function submitReflectionResponse(value: number) {
  reflectionResponses.value[currentReflectionIndex.value] = value;

  if (currentReflectionIndex.value === 0) {
    currentReflectionIndex.value = 1;
    return;
  }

  const isPersisted = await persistCurrentTaskBlock();
  if (!isPersisted) {
    return;
  }

  if (currentTaskIndex.value >= taskSequence.value.length - 1) {
    workflowState.value = 'completed';
    disposeTask();
    return;
  }

  currentTaskIndex.value += 1;
  prepareCurrentTask();
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  void refreshMuseConnectionStatus();
  startMuseStatusPolling();
  syncNBackSessionContext();
});

watch([sessionId, workflowState, currentTaskIndex, randomizedLevelOrder], () => {
  syncNBackSessionContext();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  if (museStatusInterval) {
    clearInterval(museStatusInterval);
    museStatusInterval = null;
  }
  if (feedbackAudioContext && feedbackAudioContext.state !== 'closed') {
    void feedbackAudioContext.close();
  }
  feedbackNoiseBufferCache.clear();
  feedbackAudioContext = null;
  disposeTask();
});
</script>

<template>
  <div class="n-back-screen bg-base-100 text-base-content" :class="{ 'stars-paused': workflowState === 'task-running' }">
    <div v-if="shouldShowMuseWarning" class="muse-indicator" :class="museIndicatorClass">
      <span class="muse-indicator-dot" />
      <span>{{ museIndicatorText }}</span>
    </div>

    <div v-if="workflowState === 'setup'" class="setup-container">
      <h1 class="setup-title">{{ interfaceConfig.title }}</h1>
      <p class="setup-overview">{{ interfaceConfig.description }}</p>

      <button class="btn btn-primary" type="button" @click="startWorkflow">
        Start the adventure
      </button>
    </div>

    <div v-else-if="showTaskUi" class="task-shell">
      <div v-if="showDistractions" class="distraction-layer" aria-hidden="true">
        <span
          v-for="dot in distractionDots"
          :key="dot.id"
          class="distraction-dot"
          :style="{
            width: `${dot.sizePx}px`,
            height: `${dot.sizePx}px`,
            top: `${dot.topPercent}%`,
            left: `${dot.leftPercent}%`,
            '--dot-duration': `${dot.durationMs}ms`,
            '--dot-delay': `${dot.delayMs}ms`,
            '--dot-flicker-duration': `${dot.flickerDurationMs}ms`,
            '--dot-flicker-delay': `${dot.flickerDelayMs}ms`,
            '--dot-drift-x': `${dot.driftX}px`,
            '--dot-drift-y': `${dot.driftY}px`,
            opacity: `${dot.opacity}`
          }"
        />

        <span
          v-for="meteor in meteorites"
          :key="meteor.id"
          class="meteorite"
          aria-hidden="true"
          @animationiteration="rerollMeteoriteTrajectory(meteor.id)"
          :style="{
            top: `${meteor.topPercent}%`,
            left: `${meteor.leftPercent}%`,
            width: `${meteor.sizePx}px`,
            height: `${meteor.sizePx}px`,
            '--meteor-size': `${meteor.sizePx}px`,
            '--meteor-duration': `${meteor.durationMs}ms`,
            '--meteor-delay': `${meteor.delayMs}ms`,
            '--meteor-travel-x': `${meteor.travelX}px`,
            '--meteor-travel-y': `${meteor.travelY}px`,
            '--meteor-trail-angle': `${meteor.trailAngleDeg}deg`,
            '--meteor-rotation': `${meteor.rotationDeg}deg`,
            '--meteor-intensity': `${meteor.intensity}`
          }"
        />

      </div>

      <div class="progress-panel">
        <div class="progress-label">Level Progress</div>
        <div
          class="progress-track"
          role="progressbar"
          :aria-valuenow="completedTrialsDisplay"
          aria-valuemin="0"
          :aria-valuemax="currentTaskTotalTrials"
        >
          <div class="progress-fill" :style="{ width: `${progressPercentDisplay}%` }" />
        </div>

        <div class="speed-label-row">
          <div class="progress-label">Speed Bar</div>
        </div>
        <div
          class="speed-track"
          role="progressbar"
          :aria-valuenow="speedPercentDisplay"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="speed-fill" :style="{ width: `${speedPercentDisplay}%` }" />
        </div>
      </div>

      <div class="task-container">
        <div class="task-title">{{ displayTaskTitle(currentTask) }}</div>
        <div class="square-grid-wrap">
          <div class="square-grid">
            <div
              v-for="square in squareOrder"
              :key="square"
              class="square-cell"
              :class="squareClass(square)"
            />
          </div>
        </div>

        <div v-if="workflowState === 'task-ready'" class="level-start-overview">
          <div class="level-start-title">Goal for current level</div>
          <p>{{ currentLevelGoalOverview }}</p>
        </div>

        <button
          v-if="workflowState === 'task-ready'"
          class="btn btn-primary"
          type="button"
          @click="startCurrentTask"
        >
          Start Task (J)
        </button>
      </div>
    </div>

    <div v-else-if="workflowState === 'reflection'" class="reflection-container">
      <div class="reflection-header">
        Self-Reflection {{ currentReflectionIndex + 1 }} / {{ reflectionQuestions.length }}
      </div>

      <h2 class="reflection-question">{{ activeReflectionQuestion?.text }}</h2>

      <div class="reflection-scale-row">
        <button
          v-for="value in reflectionScaleValues"
          :key="value"
          class="reflection-option"
          type="button"
          :disabled="isSaving"
          @click="submitReflectionResponse(value)"
        >
          {{ value }}
        </button>
      </div>

      <div class="scale-label-row">
        <span>{{ activeReflectionQuestion?.minLabel }}</span>
        <span>{{ activeReflectionQuestion?.midLabel }}</span>
        <span>{{ activeReflectionQuestion?.maxLabel }}</span>
      </div>

      <div v-if="saveError" class="save-error">{{ saveError }}</div>
      <div v-if="isSaving" class="save-status">Saving responses...</div>
    </div>

    <div v-else class="completed-container">
      <h2>Escape complete, you have reached the Target Dimension!</h2>
      <p>
        Thank you for your great guidance today Captain, you saved us from the galactic monsters.
        Keep up the good work!
      </p>
      <p>This was it for today's session, please return tomorrow for another space escape!</p>
      <button class="btn btn-primary" type="button" @click="closeNBackWindowAndReturn">
        Return to own PC Dimension
      </button>
    </div>
  </div>
</template>

<style scoped>
.n-back-screen {
  --stimulus-color: #ffffff;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-height: 100vh;
  padding: 20px;
  background:
    radial-gradient(circle at 20% 15%, rgba(56, 189, 248, 0.16), transparent 28%),
    radial-gradient(circle at 80% 25%, rgba(165, 180, 252, 0.14), transparent 30%),
    radial-gradient(circle at 35% 80%, rgba(14, 165, 233, 0.1), transparent 34%),
    linear-gradient(180deg, #020617 0%, #0f172a 55%, #111827 100%);
  overflow: hidden;
}

.n-back-screen::before,
.n-back-screen::after {
  content: '';
  position: absolute;
  inset: -10%;
  pointer-events: none;
}

.n-back-screen::before {
  background-image:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.8) 1px, transparent 1.5px),
    radial-gradient(circle at 82% 24%, rgba(255, 255, 255, 0.65) 1px, transparent 1.5px),
    radial-gradient(circle at 32% 76%, rgba(148, 163, 184, 0.8) 1px, transparent 1.6px),
    radial-gradient(circle at 60% 62%, rgba(226, 232, 240, 0.75) 1px, transparent 1.5px),
    radial-gradient(circle at 42% 36%, rgba(255, 255, 255, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 72% 82%, rgba(226, 232, 240, 0.75) 1px, transparent 1.6px),
    radial-gradient(circle at 24% 48%, rgba(255, 255, 255, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 6% 36%, rgba(255, 255, 255, 0.75) 1px, transparent 1.4px),
    radial-gradient(circle at 18% 68%, rgba(226, 232, 240, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 28% 10%, rgba(255, 255, 255, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 38% 58%, rgba(191, 219, 254, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 48% 84%, rgba(255, 255, 255, 0.72) 1px, transparent 1.5px),
    radial-gradient(circle at 58% 28%, rgba(226, 232, 240, 0.72) 1px, transparent 1.6px),
    radial-gradient(circle at 68% 12%, rgba(255, 255, 255, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 78% 54%, rgba(191, 219, 254, 0.72) 1px, transparent 1.5px),
    radial-gradient(circle at 88% 38%, rgba(255, 255, 255, 0.68) 1px, transparent 1.5px),
    radial-gradient(circle at 94% 74%, rgba(226, 232, 240, 0.75) 1px, transparent 1.6px),
    radial-gradient(circle at 52% 46%, rgba(255, 255, 255, 0.65) 1px, transparent 1.5px),
    radial-gradient(circle at 8% 54%, rgba(226, 232, 240, 0.72) 1px, transparent 1.5px),
    radial-gradient(circle at 14% 86%, rgba(255, 255, 255, 0.66) 1px, transparent 1.5px),
    radial-gradient(circle at 20% 30%, rgba(191, 219, 254, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 26% 72%, rgba(255, 255, 255, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 34% 44%, rgba(226, 232, 240, 0.68) 1px, transparent 1.5px),
    radial-gradient(circle at 44% 18%, rgba(255, 255, 255, 0.68) 1px, transparent 1.5px),
    radial-gradient(circle at 54% 66%, rgba(191, 219, 254, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 62% 40%, rgba(255, 255, 255, 0.68) 1px, transparent 1.5px),
    radial-gradient(circle at 70% 90%, rgba(226, 232, 240, 0.68) 1px, transparent 1.6px),
    radial-gradient(circle at 76% 22%, rgba(255, 255, 255, 0.68) 1px, transparent 1.5px),
    radial-gradient(circle at 84% 60%, rgba(191, 219, 254, 0.7) 1px, transparent 1.5px),
    radial-gradient(circle at 90% 28%, rgba(255, 255, 255, 0.66) 1px, transparent 1.5px),
    radial-gradient(circle at 98% 56%, rgba(226, 232, 240, 0.7) 1px, transparent 1.6px),
    radial-gradient(circle at 3% 12%, rgba(255, 255, 255, 0.64) 1px, transparent 1.5px),
    radial-gradient(circle at 9% 42%, rgba(226, 232, 240, 0.66) 1px, transparent 1.5px),
    radial-gradient(circle at 15% 64%, rgba(191, 219, 254, 0.66) 1px, transparent 1.5px),
    radial-gradient(circle at 21% 92%, rgba(255, 255, 255, 0.64) 1px, transparent 1.5px),
    radial-gradient(circle at 37% 26%, rgba(226, 232, 240, 0.65) 1px, transparent 1.5px),
    radial-gradient(circle at 45% 72%, rgba(255, 255, 255, 0.64) 1px, transparent 1.5px),
    radial-gradient(circle at 57% 8%, rgba(191, 219, 254, 0.66) 1px, transparent 1.5px),
    radial-gradient(circle at 63% 58%, rgba(255, 255, 255, 0.65) 1px, transparent 1.5px),
    radial-gradient(circle at 71% 34%, rgba(226, 232, 240, 0.64) 1px, transparent 1.5px),
    radial-gradient(circle at 79% 78%, rgba(255, 255, 255, 0.64) 1px, transparent 1.5px),
    radial-gradient(circle at 87% 6%, rgba(191, 219, 254, 0.66) 1px, transparent 1.5px),
    radial-gradient(circle at 95% 48%, rgba(226, 232, 240, 0.65) 1px, transparent 1.5px);
  opacity: 1;
  animation: stars-drift-1 38s linear infinite;
}

.n-back-screen::after {
  background-image:
    radial-gradient(circle at 16% 42%, rgba(191, 219, 254, 0.65) 1px, transparent 1.7px),
    radial-gradient(circle at 88% 66%, rgba(255, 255, 255, 0.65) 1px, transparent 1.7px),
    radial-gradient(circle at 50% 20%, rgba(148, 163, 184, 0.7) 1px, transparent 1.6px),
    radial-gradient(circle at 36% 90%, rgba(226, 232, 240, 0.65) 1px, transparent 1.7px),
    radial-gradient(circle at 66% 44%, rgba(255, 255, 255, 0.6) 1px, transparent 1.7px),
    radial-gradient(circle at 8% 72%, rgba(186, 230, 253, 0.55) 1px, transparent 1.6px),
    radial-gradient(circle at 12% 8%, rgba(191, 219, 254, 0.55) 1px, transparent 1.7px),
    radial-gradient(circle at 22% 34%, rgba(226, 232, 240, 0.6) 1px, transparent 1.6px),
    radial-gradient(circle at 30% 62%, rgba(255, 255, 255, 0.55) 1px, transparent 1.7px),
    radial-gradient(circle at 40% 14%, rgba(191, 219, 254, 0.6) 1px, transparent 1.7px),
    radial-gradient(circle at 48% 52%, rgba(226, 232, 240, 0.58) 1px, transparent 1.7px),
    radial-gradient(circle at 56% 76%, rgba(255, 255, 255, 0.55) 1px, transparent 1.7px),
    radial-gradient(circle at 64% 8%, rgba(186, 230, 253, 0.58) 1px, transparent 1.6px),
    radial-gradient(circle at 72% 30%, rgba(226, 232, 240, 0.6) 1px, transparent 1.7px),
    radial-gradient(circle at 80% 52%, rgba(255, 255, 255, 0.56) 1px, transparent 1.7px),
    radial-gradient(circle at 90% 16%, rgba(191, 219, 254, 0.55) 1px, transparent 1.7px),
    radial-gradient(circle at 96% 42%, rgba(226, 232, 240, 0.58) 1px, transparent 1.7px),
    radial-gradient(circle at 4% 18%, rgba(191, 219, 254, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 10% 58%, rgba(255, 255, 255, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 18% 80%, rgba(226, 232, 240, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 26% 24%, rgba(186, 230, 253, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 34% 52%, rgba(255, 255, 255, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 42% 74%, rgba(191, 219, 254, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 50% 6%, rgba(226, 232, 240, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 58% 36%, rgba(255, 255, 255, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 66% 68%, rgba(191, 219, 254, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 74% 88%, rgba(226, 232, 240, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 82% 10%, rgba(186, 230, 253, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 92% 70%, rgba(255, 255, 255, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 98% 24%, rgba(191, 219, 254, 0.54) 1px, transparent 1.7px),
    radial-gradient(circle at 6% 30%, rgba(255, 255, 255, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 14% 50%, rgba(191, 219, 254, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 24% 92%, rgba(226, 232, 240, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 32% 18%, rgba(186, 230, 253, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 40% 60%, rgba(255, 255, 255, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 46% 34%, rgba(191, 219, 254, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 54% 82%, rgba(226, 232, 240, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 62% 14%, rgba(186, 230, 253, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 70% 46%, rgba(255, 255, 255, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 78% 74%, rgba(191, 219, 254, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 86% 26%, rgba(226, 232, 240, 0.52) 1px, transparent 1.7px),
    radial-gradient(circle at 94% 58%, rgba(186, 230, 253, 0.52) 1px, transparent 1.7px);
  opacity: 0.9;
  animation: stars-drift-2 52s linear infinite;
}

.n-back-screen.stars-paused::before,
.n-back-screen.stars-paused::after {
  animation-play-state: paused;
}

.n-back-screen > * {
  position: relative;
  z-index: 1;
}

.muse-indicator {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.muse-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
}

.muse-indicator-connected {
  background: #dcfce7;
  border-color: #86efac;
  color: #166534;
}

.muse-indicator-warning {
  background: #fef9c3;
  border-color: #fde047;
  color: #854d0e;
}

.muse-indicator-bad {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #991b1b;
}

.setup-container,
.completed-container {
  margin: 0 auto;
  display: flex;
  min-height: calc(100vh - 40px);
  max-width: 860px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
  color: #cbd5e1;
}

.setup-title {
  font-size: 34px;
  font-weight: 700;
  text-align: center;
  color: #cbd5e1;
}

.setup-overview {
  max-width: 860px;
  font-size: 17px;
  color: #cbd5e1;
  text-align: center;
  line-height: 1.55;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  background-color: #0f172a;
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
}

.task-shell {
  position: relative;
  min-height: calc(100vh - 40px);
}

.progress-panel {
  position: absolute;
  top: 0;
  left: 0;
  width: 260px;
  z-index: 3;
}

.progress-label {
  margin-bottom: 6px;
  font-size: 12px;
  color: #cbd5e1;
}

.progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #d1d5db;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #334155;
  transition: width 120ms linear;
}

.speed-label-row {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.speed-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.85);
  overflow: hidden;
}

.speed-fill {
  height: 100%;
  background: linear-gradient(90deg, #ef4444 0%, #f59e0b 52%, #22c55e 100%);
  transition: width 120ms linear;
}

.task-container {
  position: relative;
  z-index: 2;
  display: flex;
  min-height: calc(100vh - 40px);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.task-title {
  font-size: 24px;
  font-weight: 700;
  color: #cbd5e1;
}

.square-grid-wrap {
  position: relative;
  display: grid;
  place-items: center;
}

.square-grid {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(3, 110px);
  grid-template-rows: repeat(3, 110px);
  gap: 18px;
}

.square-cell {
  display: grid;
  place-items: center;
  border: 1px solid #9ca3af;
  border-radius: 2px;
  transition: background-color 50ms linear;
}

.square-idle {
  background: #808080;
}

.square-highlighted {
  background: var(--stimulus-color);
}

.square-center {
  position: relative;
  border: none;
  border-radius: 0;
  background: transparent;
}

.square-center::before,
.square-center::after {
  content: '';
  position: absolute;
  background: #e2e8f0;
  pointer-events: none;
}

.square-center::before {
  left: 0;
  right: 0;
  top: 50%;
  height: 12px;
  transform: translateY(-50%);
}

.square-center::after {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 12px;
  transform: translateX(-50%);
}

.level-start-overview {
  width: min(680px, calc(100vw - 60px));
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.7);
  color: #e2e8f0;
  padding: 12px 14px;
  text-align: center;
}

.level-start-title {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #93c5fd;
}

.level-start-overview p {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
}

.reflection-container {
  margin: 0 auto;
  display: flex;
  min-height: calc(100vh - 40px);
  max-width: 760px;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}

.reflection-header {
  color: #cbd5e1;
  font-size: 14px;
}

.reflection-question {
  font-size: 26px;
  font-weight: 700;
  color: #cbd5e1;
}

.reflection-scale-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.reflection-option {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #0f172a;
  height: 44px;
  font-size: 16px;
  font-weight: 600;
}

.reflection-option:hover:enabled {
  background: #e2e8f0;
  color: #020617;
}

.reflection-option:disabled {
  background: #e2e8f0;
  color: #475569;
}

.scale-label-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  color: #cbd5e1;
  font-size: 13px;
}

.scale-label-row span:nth-child(2) {
  text-align: center;
}

.scale-label-row span:nth-child(3) {
  text-align: right;
}

.save-error {
  color: #b91c1c;
  font-size: 14px;
}

.save-status {
  color: #cbd5e1;
  font-size: 14px;
}

.distraction-layer {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  contain: layout paint;
}

.distraction-dot {
  position: absolute;
  border-radius: 999px;
  background: var(--stimulus-color);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.35);
  will-change: transform, opacity;
  animation:
    drift var(--dot-duration) ease-in-out infinite,
    dot-flicker var(--dot-flicker-duration) steps(5, end) infinite;
  animation-delay: var(--dot-delay), var(--dot-flicker-delay);
}

.meteorite {
  position: absolute;
  border-radius: 999px;
  background: radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.94) 36%, rgba(203, 213, 225, 0.88) 72%, rgba(148, 163, 184, 0.92) 100%);
  box-shadow: 0 0 16px rgba(255, 255, 255, calc(0.45 * var(--meteor-intensity)));
  opacity: 0;
  mix-blend-mode: normal;
  transform-origin: center;
  will-change: transform, opacity;
  animation: meteorite-fly var(--meteor-duration) linear infinite;
  animation-delay: var(--meteor-delay);
  overflow: visible;
}

.meteorite::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(circle at 30% 34%, rgba(100, 116, 139, 0.45) 0 12%, transparent 14%),
    radial-gradient(circle at 64% 60%, rgba(71, 85, 105, 0.42) 0 14%, transparent 17%);
}

.meteorite::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--meteor-size) * 2.9);
  height: calc(var(--meteor-size) * 0.26);
  /* Rotate around the meteor centre so the trail always points away from travel direction. */
  transform-origin: left center;
  transform: translateY(-50%) rotate(var(--meteor-trail-angle));
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, calc(0.78 * var(--meteor-intensity))),
    rgba(191, 219, 254, calc(0.32 * var(--meteor-intensity))),
    rgba(255, 255, 255, 0)
  );
}

@media (prefers-reduced-motion: reduce) {
  .distraction-dot,
  .meteorite {
    animation: none;
    opacity: 0.22;
    transform: none;
  }
}

@keyframes drift {
  0% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(var(--dot-drift-x), var(--dot-drift-y)) scale(1.15);
  }
  100% {
    transform: translate(0, 0) scale(1);
  }
}

@keyframes dot-flicker {
  0%,
  100% {
    opacity: 0.35;
  }
  20% {
    opacity: 0.95;
  }
  55% {
    opacity: 0.2;
  }
  75% {
    opacity: 0.75;
  }
}

@keyframes meteorite-fly {
  0%,
  100% {
    opacity: 0;
    transform: translate3d(0, 0, 0) scale(0.85) rotate(var(--meteor-rotation));
  }
  8% {
    opacity: calc(0.9 * var(--meteor-intensity));
  }
  18% {
    opacity: calc(1 * var(--meteor-intensity));
  }
  78% {
    opacity: calc(0.2 * var(--meteor-intensity));
    transform: translate3d(var(--meteor-travel-x), var(--meteor-travel-y), 0) scale(1.12)
      rotate(var(--meteor-rotation));
  }
  92% {
    opacity: 0;
    transform: translate3d(var(--meteor-travel-x), var(--meteor-travel-y), 0) scale(1.18)
      rotate(var(--meteor-rotation));
  }
}

@keyframes stars-drift-1 {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  100% {
    transform: translate3d(-14%, -9%, 0) scale(1.04);
  }
}

@keyframes stars-drift-2 {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  100% {
    transform: translate3d(12%, -8%, 0) scale(1.03);
  }
}

@media (max-width: 640px) {
  .muse-indicator {
    top: 8px;
    font-size: 11px;
    padding: 3px 8px;
  }

  .task-title {
    font-size: 20px;
  }

  .progress-panel {
    width: 180px;
  }

  .square-grid {
    grid-template-columns: repeat(3, 80px);
    grid-template-rows: repeat(3, 80px);
    gap: 12px;
  }

  .square-center::before {
    height: 10px;
  }

  .square-center::after {
    width: 10px;
  }

  .reflection-question {
    font-size: 20px;
  }

  .reflection-option {
    height: 40px;
  }
}
</style>
