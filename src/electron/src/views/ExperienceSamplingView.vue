<script lang="ts" setup>
import typedIpcRenderer from '../utils/typedIpcRenderer';
import studyConfig from '../../shared/study.config';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { ExperienceSamplingQuestion } from '../../shared/StudyConfiguration';

const zurichTimeZone = 'Europe/Zurich';
const esConfig = studyConfig.trackers.experienceSamplingTracker;
const studyQuestions = esConfig.questions;

// Always use the first two configured questions in order.
const selectedQuestions: ExperienceSamplingQuestion[] =
  studyQuestions.length >= 2
    ? [studyQuestions[0], studyQuestions[1]]
    : studyQuestions.length === 1
      ? [studyQuestions[0]]
      : [];

const currentQuestionIndex = ref(0);
const responses = ref<Array<string | undefined>>([]);

const activeQuestion = computed<ExperienceSamplingQuestion>(
  () => selectedQuestions[currentQuestionIndex.value] ?? selectedQuestions[0]
);
const questionProgressLabel = computed(
  () =>
    `${Math.min(currentQuestionIndex.value + 1, selectedQuestions.length)} / ${selectedQuestions.length}`
);

const scale = computed(() =>
  activeQuestion.value.answerType === 'LikertScale'
    ? Array.from({ length: activeQuestion.value.scale }, (_, i) => i + 1)
    : []
);
const choiceOptions = computed(() =>
  activeQuestion.value.answerType === 'SingleChoice' ||
  activeQuestion.value.answerType === 'MultiChoice'
    ? activeQuestion.value.responseOptions
    : []
);
const useChoiceDropdown = computed(() => choiceOptions.value.length >= 10);
const choiceSelectSize = computed(() => Math.min(Math.max(choiceOptions.value.length, 6), 10));

const language =
  (typeof navigator !== 'undefined' &&
    (navigator.language || (navigator.languages && navigator.languages[0]))) ||
  'en';

const promptedAt = new Date();
const promptedAtString = new Intl.DateTimeFormat(language, {
  timeZone: zurichTimeZone,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23'
}).format(promptedAt);

const isSubmitting = ref(false);
const submitMode = ref<'answer' | 'skip' | null>(null);
const textResponse = ref('');
const singleChoiceResponse = ref<string | null>(null);
const multiChoiceResponse = ref<string[]>([]);

const needsSubmitButton = computed(
  () =>
    activeQuestion.value.answerType === 'TextResponse' ||
    activeQuestion.value.answerType === 'MultiChoice'
);

const rootEl = ref<HTMLElement | null>(null);

async function measureAndResize() {
  await nextTick();
  const el = rootEl.value;
  if (!el) return;
  typedIpcRenderer.invoke('resizeExperienceSamplingWindow', Math.ceil(el.scrollHeight) + 2);
}

onMounted(() => {
  measureAndResize();
});

watch(currentQuestionIndex, () => {
  textResponse.value = '';
  singleChoiceResponse.value = null;
  multiChoiceResponse.value = [];
  measureAndResize();
});

const textMode = computed(() => {
  return activeQuestion.value.answerType === 'TextResponse'
    ? activeQuestion.value.responseOptions
    : 'singleLine';
});

const textMaxLength = computed(() => {
  return activeQuestion.value.answerType === 'TextResponse' ? activeQuestion.value.maxLength : 0;
});

const isAnswerReady = computed(() => {
  if (activeQuestion.value.answerType === 'TextResponse') {
    return textResponse.value.trim().length > 0;
  }
  if (activeQuestion.value.answerType === 'SingleChoice') {
    return singleChoiceResponse.value !== null;
  }
  if (activeQuestion.value.answerType === 'MultiChoice') {
    return multiChoiceResponse.value.length > 0;
  }
  return false;
});

function buildResponseOptionsSnapshot(q: ExperienceSamplingQuestion): string {
  if (q.answerType === 'LikertScale') {
    return JSON.stringify({
      type: 'LikertScale',
      scale: q.scale,
      labels: q.responseOptions
    });
  }
  if (q.answerType === 'TextResponse') {
    return JSON.stringify({
      type: 'TextResponse',
      inputType: q.responseOptions,
      maxLength: q.maxLength
    });
  }
  return JSON.stringify({
    type: q.answerType,
    options: q.responseOptions
  });
}

function buildResponseValue(answer?: number): string | undefined {
  if (activeQuestion.value.answerType === 'LikertScale') {
    return answer?.toString();
  }
  if (activeQuestion.value.answerType === 'TextResponse') {
    const trimmed = textResponse.value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (activeQuestion.value.answerType === 'SingleChoice') {
    return singleChoiceResponse.value ?? undefined;
  }
  if (activeQuestion.value.answerType === 'MultiChoice') {
    return multiChoiceResponse.value.length > 0
      ? JSON.stringify(multiChoiceResponse.value)
      : undefined;
  }
  return undefined;
}

function toggleMultiChoiceOption(option: string) {
  if (activeQuestion.value.answerType !== 'MultiChoice') {
    return;
  }
  if (multiChoiceResponse.value.includes(option)) {
    multiChoiceResponse.value = multiChoiceResponse.value.filter((item) => item !== option);
  } else {
    multiChoiceResponse.value = [...multiChoiceResponse.value, option];
  }
}

function selectSingleChoiceOption(option: string) {
  if (activeQuestion.value.answerType !== 'SingleChoice') {
    return;
  }
  singleChoiceResponse.value = option;
  createExperienceSample();
}

function onSingleChoiceDropdownChange(value: string) {
  if (activeQuestion.value.answerType !== 'SingleChoice') {
    return;
  }
  singleChoiceResponse.value = value || null;
  if (singleChoiceResponse.value) {
    createExperienceSample();
  }
}

function onMultiChoiceDropdownChange(event: Event) {
  if (activeQuestion.value.answerType !== 'MultiChoice') {
    return;
  }
  const selected = Array.from((event.target as HTMLSelectElement).selectedOptions).map(
    (option) => option.value
  );
  multiChoiceResponse.value = selected;
}

async function createExperienceSample(answer?: number) {
  const responseValue = buildResponseValue(answer);
  responses.value[currentQuestionIndex.value] = responseValue;

  // If there are more questions, advance to the next one.
  if (currentQuestionIndex.value < selectedQuestions.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    currentQuestionIndex.value += 1;
    return;
  }

  // All questions answered — submit.
  isSubmitting.value = true;
  submitMode.value = 'answer';

  const q1 = selectedQuestions[0];
  const q2 = selectedQuestions.length > 1 ? selectedQuestions[1] : null;

  try {
    await Promise.all([
      typedIpcRenderer.invoke(
        'createExperienceSample',
        promptedAt,
        q1.question,
        q1.answerType,
        buildResponseOptionsSnapshot(q1),
        q1.answerType === 'LikertScale' ? q1.scale : null,
        responses.value[0],
        q2 ? q2.question : null,
        q2 ? q2.answerType : null,
        q2 ? buildResponseOptionsSnapshot(q2) : null,
        q2 && q2.answerType === 'LikertScale' ? q2.scale : null,
        responses.value[1],
        false
      ),
      new Promise((resolve) => setTimeout(resolve, 150))
    ]);
    await typedIpcRenderer.invoke('closeExperienceSamplingWindow', false);
  } catch (error) {
    console.error('Error creating experience sample', error);
  } finally {
    isSubmitting.value = false;
    submitMode.value = null;
  }
}

async function skipExperienceSample() {
  isSubmitting.value = true;
  submitMode.value = 'skip';

  const q1 = selectedQuestions[0];
  const q2 = selectedQuestions.length > 1 ? selectedQuestions[1] : null;

  try {
    await Promise.all([
      typedIpcRenderer.invoke(
        'createExperienceSample',
        promptedAt,
        q1.question,
        q1.answerType,
        buildResponseOptionsSnapshot(q1),
        q1.answerType === 'LikertScale' ? q1.scale : null,
        undefined,
        q2 ? q2.question : null,
        q2 ? q2.answerType : null,
        q2 ? buildResponseOptionsSnapshot(q2) : null,
        q2 && q2.answerType === 'LikertScale' ? q2.scale : null,
        undefined,
        true
      ),
      new Promise((resolve) => setTimeout(resolve, 150))
    ]);
    await typedIpcRenderer.invoke('closeExperienceSamplingWindow', true);
  } catch (error) {
    console.error('Error creating experience sample', error);
  } finally {
    isSubmitting.value = false;
    submitMode.value = null;
  }
}
</script>
<template>
  <div ref="rootEl" class="experience-sampling-notification flex flex-col">
    <div class="notification-top-bar">
      <div>Self-Reflection: {{ studyConfig.name }}</div>
      <div>{{ promptedAtString }}</div>
    </div>
    <div class="pointer-events-auto flex flex-row">
      <div class="flex flex-1 p-4 pt-1">
        <div class="flex flex-1 flex-col">
          <div class="flex items-baseline justify-between">
            <p class="prompt">{{ activeQuestion.question }}</p>
            <span
              v-if="selectedQuestions.length > 1"
              class="ml-2 whitespace-nowrap text-xs text-gray-400"
              >{{ questionProgressLabel }}</span
            >
          </div>

          <div
            v-if="activeQuestion.answerType === 'LikertScale'"
            class="-mx-1 mt-2 flex flex-row justify-between"
          >
            <div
              v-for="value in scale"
              :key="value"
              class="sample-answer"
              @click="!isSubmitting && createExperienceSample(value)"
            >
              <span
                v-if="!(isSubmitting && submitMode === 'answer')"
                class="mx-auto flex font-medium"
              >
                {{ value }}
              </span>
              <span v-else class="mx-auto flex font-medium">
                <span class="loading loading-spinner loading-xs" />
              </span>
            </div>
          </div>

          <div
            v-if="activeQuestion.answerType === 'LikertScale'"
            class="mt-1 flex flex-row text-sm text-gray-400 dark:text-gray-500"
          >
            <div class="basis-1/3">{{ (activeQuestion as any).responseOptions[0] }}</div>
            <div class="basis-1/3 text-center">
              <span v-if="(activeQuestion as any).responseOptions.length === 3">{{
                (activeQuestion as any).responseOptions[1]
              }}</span>
            </div>
            <div class="basis-1/3 text-right">
              {{
                (activeQuestion as any).responseOptions[2] ||
                (activeQuestion as any).responseOptions[1]
              }}
            </div>
          </div>

          <div v-if="activeQuestion.answerType === 'TextResponse'" class="mt-2 flex flex-col">
            <div class="text-answer-content">
              <div v-if="textMode === 'singleLine'" class="text-answer-wrapper">
                <input
                  v-model="textResponse"
                  class="text-answer-input"
                  :maxlength="textMaxLength"
                  type="text"
                />
                <span class="char-counter">{{ textResponse.length }}/{{ textMaxLength }}</span>
              </div>
              <div v-else class="text-answer-wrapper text-answer-wrapper-multi">
                <textarea
                  v-model="textResponse"
                  class="text-answer-textarea"
                  :maxlength="textMaxLength"
                />
                <span class="char-counter">{{ textResponse.length }}/{{ textMaxLength }}</span>
              </div>
            </div>
          </div>

          <div
            v-if="
              activeQuestion.answerType === 'SingleChoice' ||
              activeQuestion.answerType === 'MultiChoice'
            "
            class="mt-1 flex flex-col"
          >
            <div class="choice-hint">
              {{ activeQuestion.answerType === 'SingleChoice' ? 'Pick one' : 'Pick one or more' }}
            </div>
            <div class="choice-answer-content">
              <div v-if="!useChoiceDropdown" class="choice-list">
                <button
                  v-for="option in choiceOptions"
                  :key="option"
                  class="choice-option"
                  :class="{
                    'choice-option-selected':
                      activeQuestion.answerType === 'SingleChoice'
                        ? singleChoiceResponse === option
                        : multiChoiceResponse.includes(option)
                  }"
                  :disabled="isSubmitting"
                  @click="
                    activeQuestion.answerType === 'SingleChoice'
                      ? selectSingleChoiceOption(option)
                      : toggleMultiChoiceOption(option)
                  "
                >
                  {{ option }}
                </button>
              </div>

              <div v-else>
                <select
                  v-if="activeQuestion.answerType === 'SingleChoice'"
                  class="choice-select"
                  :value="singleChoiceResponse ?? ''"
                  :disabled="isSubmitting"
                  @change="onSingleChoiceDropdownChange(($event.target as HTMLSelectElement).value)"
                >
                  <option value="" disabled>Select an option</option>
                  <option v-for="option in choiceOptions" :key="option" :value="option">
                    {{ option }}
                  </option>
                </select>

                <select
                  v-else
                  class="choice-select choice-select-multi"
                  :size="choiceSelectSize"
                  multiple
                  :disabled="isSubmitting"
                  @change="onMultiChoiceDropdownChange($event)"
                >
                  <option
                    v-for="option in choiceOptions"
                    :key="option"
                    :value="option"
                    :selected="multiChoiceResponse.includes(option)"
                  >
                    {{ option }}
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="flex cursor-pointer self-stretch border-l border-gray-200 dark:border-gray-600">
        <div class="flex w-full flex-col items-center justify-center">
          <button
            v-if="needsSubmitButton"
            class="submit-side-button"
            :disabled="!isAnswerReady || isSubmitting"
            @click="createExperienceSample()"
          >
            <span v-if="!(isSubmitting && submitMode === 'answer')">Submit</span>
            <span v-else class="loading loading-spinner loading-xs" />
          </button>
          <div class="skip-button" @click="!isSubmitting && skipExperienceSample()">
            <span v-if="!(isSubmitting && submitMode === 'skip')">Skip</span>
            <span v-else class="loading loading-spinner loading-xs" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style lang="less" scoped>
@import '@/styles/index.less';
@import '../styles/tailwind-apply.css';
.experience-sampling-notification {
  .prompt {
    color: @primary-color;
  }

  .text-answer-wrapper {
    position: relative;
  }

  .text-answer-input,
  .text-answer-textarea {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: #ffffff;
    color: #1f2937;
    padding: 0.5rem 0.625rem;
    outline: none;
  }

  @media (prefers-color-scheme: dark) {
    .text-answer-input,
    .text-answer-textarea {
      border-color: #4b5563;
      background: #374151;
      color: #e5e7eb;
    }
  }

  .text-answer-input {
    height: 2.25rem;
    padding-right: 4.5rem;
  }

  .text-answer-textarea {
    height: 14rem;
    min-height: 14rem;
    max-height: 14rem;
    resize: none;
    overflow-y: auto;
    padding-bottom: 1.5rem;
  }

  .text-answer-input:focus,
  .text-answer-textarea:focus {
    border-color: #93c5fd;
    box-shadow: 0 0 0 2px rgb(147 197 253 / 0.25);
  }

  .char-counter {
    position: absolute;
    font-size: 0.675rem;
    color: #9ca3af;
    pointer-events: none;
  }

  .text-answer-wrapper:not(.text-answer-wrapper-multi) .char-counter {
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .text-answer-wrapper-multi .char-counter {
    right: 0.625rem;
    bottom: 0.375rem;
  }

  .text-answer-content,
  .choice-answer-content {
    padding-right: 0.25rem;
  }

  .choice-hint {
    font-size: 0.7rem;
    color: #9ca3af;
    margin-bottom: 0.35rem;
  }

  @media (prefers-color-scheme: dark) {
    .choice-hint {
      color: #6b7280;
    }
  }

  .choice-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }

  .choice-option {
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: #f3f4f6;
    color: #374151;
    text-align: left;
    padding: 0.3rem 0.625rem;
    font-size: 0.8rem;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
  }

  .choice-option:hover {
    background: #e5e7eb;
    color: #111827;
  }

  .choice-option-selected {
    background: #374151;
    border-color: #374151;
    color: #ffffff;
  }

  @media (prefers-color-scheme: dark) {
    .choice-option {
      border-color: #4b5563;
      background: #374151;
      color: #d1d5db;
    }

    .choice-option:hover {
      background: #4b5563;
      color: #f3f4f6;
    }

    .choice-option-selected {
      background: #60a5fa;
      border-color: #60a5fa;
      color: #ffffff;
    }
  }

  .choice-select {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: #ffffff;
    color: #1f2937;
    padding: 0.45rem 0.625rem;
    font-size: 0.8rem;
    outline: none;
  }

  .choice-select:focus {
    border-color: #93c5fd;
    box-shadow: 0 0 0 2px rgb(147 197 253 / 0.25);
  }

  @media (prefers-color-scheme: dark) {
    .choice-select {
      border-color: #4b5563;
      background: #374151;
      color: #e5e7eb;
    }
  }

  .choice-select-multi {
    min-height: 10rem;
    padding: 0.3rem;
  }

  .submit-side-button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #ffffff;
    background: @primary-color;
    border: none;
    cursor: pointer;
    transition: opacity 120ms ease;
  }

  .submit-side-button:hover:not(:disabled) {
    opacity: 0.85;
  }

  .submit-side-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .skip-button {
    flex: 1;
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    padding: 0 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #6b7280;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .skip-button:hover {
    background: #f3f4f6;
    color: #111827;
  }

  @media (prefers-color-scheme: dark) {
    .skip-button {
      color: #9ca3af;
    }

    .skip-button:hover {
      background: #374151;
      color: #e5e7eb;
    }
  }
}
</style>
