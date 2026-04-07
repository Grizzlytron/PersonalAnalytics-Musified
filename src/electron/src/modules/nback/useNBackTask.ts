import { computed, ref } from 'vue';

export type NBackGridCellIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type NBackStimulusCellIndex = 0 | 1 | 2 | 3 | 5 | 6 | 7 | 8;
export type SpatialTaskPhase = 'stimulus' | 'response' | 'finished';
export type SpatialTaskFeedback = 'correct' | 'incorrect' | null;

export type NBackTaskConfig = {
  n: number;
  totalTrials: number;
  startDelayMs: number;
  stimulusDurationMs: number;
  responseDurationMs: number;
  sameResponseKey: string;
};

export type SpatialTrialResult = {
  trialNumber: number;
  stimulusSquare: NBackStimulusCellIndex;
  expectedSquare: NBackStimulusCellIndex | null;
  selectedSquare: number | null;
  responded: boolean;
  isCorrect: boolean;
  pressedKey?: string | null;
  reactionTimeMs?: number | null;
};

const stimulusSquares: NBackStimulusCellIndex[] = [0, 1, 2, 3, 5, 6, 7, 8];
const targetMatchRatio = 0.33;
const zeroBackTargetSquare: NBackStimulusCellIndex = 0;

export function useNBackTask(config: NBackTaskConfig) {
  const phase = ref<SpatialTaskPhase>('stimulus');
  const activeSquare = ref<NBackStimulusCellIndex | null>(null);
  const feedback = ref<SpatialTaskFeedback>(null);
  const isRunning = ref(false);

  const trialNumber = ref(0);
  const completedTrials = ref(0);
  const expectedSquare = ref<NBackStimulusCellIndex | null>(null);
  const lastResult = ref<SpatialTrialResult | null>(null);
  const trialResults = ref<SpatialTrialResult[]>([]);
  const startedAt = ref<Date | null>(null);
  const completedAt = ref<Date | null>(null);

  const sequence: NBackStimulusCellIndex[] = [];
  let currentStimulusSquare: NBackStimulusCellIndex | null = null;

  let responseAccepted = false;
  let responsePhaseStartedAtMs: number | null = null;
  let cycleTimeout: ReturnType<typeof setTimeout> | null = null;
  const plannedMatchTrialNumbers = new Set<number>();
  const sameResponseKey = config.sameResponseKey.trim().toUpperCase();
  const responseFrameDurationMs = Math.max(config.stimulusDurationMs, config.responseDurationMs);
  const noStimulusFrameDurationMs = Math.max(
    0,
    responseFrameDurationMs - config.stimulusDurationMs
  );

  const canAcceptResponse = computed(
    () => isRunning.value && (phase.value === 'stimulus' || phase.value === 'response')
  );
  const isCurrentTrialEvaluable = computed(() => expectedSquare.value !== null);
  const hasFinished = computed(() => phase.value === 'finished');
  const evaluableTrialResults = computed(() =>
    trialResults.value.filter((result) => result.expectedSquare !== null)
  );
  const correctResponses = computed(
    () => evaluableTrialResults.value.filter((result) => result.isCorrect).length
  );
  const accuracyPercent = computed(() => {
    if (evaluableTrialResults.value.length === 0) {
      return 0;
    }
    return (correctResponses.value / evaluableTrialResults.value.length) * 100;
  });
  const progressPercent = computed(() => {
    if (config.totalTrials <= 0) {
      return 0;
    }
    return Math.min(100, (completedTrials.value / config.totalTrials) * 100);
  });
  const isWaitingToStart = computed(
    () => isRunning.value && trialNumber.value === 0 && activeSquare.value === null
  );

  function normalizeKey(key: string): string {
    return key.trim().toUpperCase();
  }

  function randomSquare(): NBackStimulusCellIndex {
    const index = Math.floor(Math.random() * stimulusSquares.length);
    return stimulusSquares[index];
  }

  function randomSquareExcluding(excludedSquare: NBackStimulusCellIndex): NBackStimulusCellIndex {
    const availableSquares = stimulusSquares.filter((square) => square !== excludedSquare);
    const index = Math.floor(Math.random() * availableSquares.length);
    return availableSquares[index];
  }

  function planMatchTrialNumbers(): void {
    plannedMatchTrialNumbers.clear();

    const evaluableTrialCount =
      config.n <= 0 ? config.totalTrials : Math.max(0, config.totalTrials - config.n);
    if (evaluableTrialCount === 0) {
      return;
    }

    const targetMatchCount = Math.max(
      0,
      Math.min(evaluableTrialCount, Math.round(evaluableTrialCount * targetMatchRatio))
    );
    const firstEvaluableTrialNumber = config.n <= 0 ? 1 : config.n + 1;
    const evaluableTrialNumbers = Array.from(
      { length: evaluableTrialCount },
      (_entry, index) => firstEvaluableTrialNumber + index
    );

    for (let index = evaluableTrialNumbers.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const currentValue = evaluableTrialNumbers[index];
      evaluableTrialNumbers[index] = evaluableTrialNumbers[swapIndex];
      evaluableTrialNumbers[swapIndex] = currentValue;
    }

    evaluableTrialNumbers.slice(0, targetMatchCount).forEach((trial) => {
      plannedMatchTrialNumbers.add(trial);
    });
  }

  function clearCycleTimeout() {
    if (cycleTimeout) {
      clearTimeout(cycleTimeout);
      cycleTimeout = null;
    }
  }

  function finishSession() {
    clearCycleTimeout();
    isRunning.value = false;
    phase.value = 'finished';
    activeSquare.value = null;
    feedback.value = null;
    completedAt.value = new Date();
  }

  function appendTrialResult(
    selectedSquare: number | null,
    responded: boolean,
    pressedKey: string | null,
    reactionTimeMs: number | null,
    userSaidSame: boolean | null
  ): void {
    if (currentStimulusSquare === null) {
      return;
    }

    const isSameTruth =
      expectedSquare.value !== null && currentStimulusSquare === expectedSquare.value;
    const effectiveUserSaidSame = userSaidSame ?? false;
    const isCorrect = expectedSquare.value !== null && effectiveUserSaidSame === isSameTruth;

    const result: SpatialTrialResult = {
      trialNumber: trialNumber.value,
      stimulusSquare: currentStimulusSquare,
      expectedSquare: expectedSquare.value,
      selectedSquare,
      responded,
      isCorrect,
      pressedKey,
      reactionTimeMs
    };

    trialResults.value.push(result);
    lastResult.value = result;

    if (expectedSquare.value !== null) {
      feedback.value = isCorrect ? 'correct' : 'incorrect';
    }
  }

  function startResponsePhase() {
    phase.value = 'response';
    activeSquare.value = null;

    clearCycleTimeout();
    cycleTimeout = setTimeout(() => {
      if (!responseAccepted) {
        appendTrialResult(null, false, null, null, false);
      }

      completedTrials.value += 1;
      if (completedTrials.value >= config.totalTrials) {
        finishSession();
        return;
      }
      runNextTrial();
    }, noStimulusFrameDurationMs);
  }

  function runNextTrial() {
    if (!isRunning.value) {
      return;
    }

    feedback.value = null;
    phase.value = 'stimulus';
    responseAccepted = false;
    responsePhaseStartedAtMs = Date.now();

    const nextTrialNumber = sequence.length + 1;
    const trialIndex = nextTrialNumber - 1;
    const expectedSquareForTrial: NBackStimulusCellIndex | null =
      config.n === 0
        ? zeroBackTargetSquare
        : config.n > 0 && trialIndex >= config.n
          ? sequence[trialIndex - config.n]
          : null;

    let stimulusSquare: NBackStimulusCellIndex;
    if (expectedSquareForTrial !== null) {
      const shouldMatch = plannedMatchTrialNumbers.has(nextTrialNumber);
      stimulusSquare = shouldMatch
        ? expectedSquareForTrial
        : randomSquareExcluding(expectedSquareForTrial);
    } else {
      stimulusSquare = randomSquare();
    }

    sequence.push(stimulusSquare);
    currentStimulusSquare = stimulusSquare;

    trialNumber.value = sequence.length;

    if (expectedSquareForTrial !== null) {
      expectedSquare.value = expectedSquareForTrial;
    } else {
      expectedSquare.value = null;
    }

    activeSquare.value = stimulusSquare;

    clearCycleTimeout();
    cycleTimeout = setTimeout(() => {
      startResponsePhase();
    }, config.stimulusDurationMs);
  }

  function submitKeyboardResponse(key: string): {
    consumed: boolean;
    evaluated: boolean;
    isCorrect?: boolean;
  } {
    if (!canAcceptResponse.value || responseAccepted) {
      return { consumed: false, evaluated: false };
    }

    if (!isCurrentTrialEvaluable.value) {
      return { consumed: false, evaluated: false };
    }

    const normalizedKey = normalizeKey(key);
    if (normalizedKey !== sameResponseKey) {
      return { consumed: false, evaluated: false };
    }

    const isSameTruth =
      expectedSquare.value !== null && currentStimulusSquare !== null && expectedSquare.value === currentStimulusSquare;
    const reactionTimeMs =
      responsePhaseStartedAtMs === null ? null : Math.max(0, Date.now() - responsePhaseStartedAtMs);

    appendTrialResult(null, true, normalizedKey, reactionTimeMs, true);
    responseAccepted = true;

    return { consumed: true, evaluated: true, isCorrect: isSameTruth };
  }

  function start() {
    clearCycleTimeout();
    sequence.length = 0;
    trialNumber.value = 0;
    completedTrials.value = 0;
    expectedSquare.value = null;
    lastResult.value = null;
    trialResults.value = [];
    feedback.value = null;
    activeSquare.value = null;
    startedAt.value = new Date();
    completedAt.value = null;
    phase.value = 'stimulus';
    responseAccepted = false;
    responsePhaseStartedAtMs = null;
    currentStimulusSquare = null;
    planMatchTrialNumbers();

    isRunning.value = true;

    clearCycleTimeout();
    cycleTimeout = setTimeout(() => {
      runNextTrial();
    }, config.startDelayMs);
  }

  function stop() {
    finishSession();
  }

  function dispose() {
    clearCycleTimeout();
    isRunning.value = false;
  }

  return {
    phase,
    activeSquare,
    feedback,
    trialNumber,
    completedTrials,
    expectedSquare,
    lastResult,
    trialResults,
    isRunning,
    hasFinished,
    startedAt,
    completedAt,
    correctResponses,
    accuracyPercent,
    progressPercent,
    isWaitingToStart,
    canAcceptResponse,
    isCurrentTrialEvaluable,
    start,
    stop,
    dispose,
    submitKeyboardResponse
  };
}
