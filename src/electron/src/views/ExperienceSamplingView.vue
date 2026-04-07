<script lang="ts" setup>
import typedIpcRenderer from '../utils/typedIpcRenderer';
import studyConfig from '../../shared/study.config';
import { computed, ref } from 'vue';

type PopupQuestion = {
  question: string;
  labels: string[];
};

const esConfig = studyConfig.trackers.experienceSamplingTracker;
const scale = Array.from({ length: esConfig.scale }, (_, i) => i + 1);
const zurichTimeZone = 'Europe/Zurich';

const language =
  (typeof navigator !== 'undefined' &&
    (navigator.language || (navigator.languages && navigator.languages[0]))) ||
  'en';

function pickTwoQuestions(): PopupQuestion[] {
  const available = esConfig.questions.map((questionText, index) => ({
    question: questionText,
    labels: esConfig.responseOptions[index] ?? []
  }));

  const uniqueConfiguredQuestions: PopupQuestion[] = [];
  const seenQuestions = new Set<string>();

  for (const question of available) {
    const key = question.question.trim().toLowerCase();
    if (key.length === 0 || seenQuestions.has(key)) {
      continue;
    }
    seenQuestions.add(key);
    uniqueConfiguredQuestions.push(question);
  }

  if (uniqueConfiguredQuestions.length >= 2) {
    // Always use the two configured questions in definition order.
    return [uniqueConfiguredQuestions[0], uniqueConfiguredQuestions[1]];
  }

  if (uniqueConfiguredQuestions.length === 1) {
    return [
      uniqueConfiguredQuestions[0],
      {
        question: 'How much effort did you put in during the previous session?',
        labels: ['not much effort', 'moderately much effort', 'very much effort']
      }
    ];
  }

  if (available.length === 0) {
    return [
      {
        question: 'How focused did you feel in the previous session?',
        labels: ['not focused', 'moderately focused', 'very focused']
      },
      {
        question: 'How well did you spend your time in the previous session?',
        labels: ['not well', 'moderately well', 'very well']
      }
    ];
  }

  return [available[0], available[1] ?? available[0]];
}

const selectedQuestions = pickTwoQuestions();
const currentQuestionIndex = ref(0);
const responses = ref<Array<number | undefined>>([]);

const activeQuestion = computed(() => selectedQuestions[currentQuestionIndex.value] ?? selectedQuestions[0]);
const questionProgressLabel = computed(
  () => `${Math.min(currentQuestionIndex.value + 1, selectedQuestions.length)} / ${selectedQuestions.length}`
);

const promptedAt = new Date();
const promptedAtString = new Intl.DateTimeFormat(language, {
  timeZone: zurichTimeZone,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23'
}).format(promptedAt);

const sampleLoadingValue = ref<number | null | undefined>(undefined);

async function submitResponse(value: number) {
  sampleLoadingValue.value = value;
  responses.value[currentQuestionIndex.value] = value;

  if (currentQuestionIndex.value < selectedQuestions.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    currentQuestionIndex.value += 1;
    sampleLoadingValue.value = undefined;
    return;
  }

  const firstQuestion = selectedQuestions[0];
  const secondQuestion = selectedQuestions[1] ?? selectedQuestions[0];
  try {
    await Promise.all([
      typedIpcRenderer.invoke(
        'createExperienceSample',
        promptedAt,
        firstQuestion.question,
        firstQuestion.labels.join(', '),
        secondQuestion.question,
        secondQuestion.labels.join(', '),
        esConfig.scale,
        responses.value[0],
        responses.value[1]
      ),
      new Promise((resolve) => setTimeout(resolve, 150))
    ]);
    await typedIpcRenderer.invoke('closeExperienceSamplingWindow', false);
  } catch (error) {
    console.error('Error creating experience sample', error);
  }
}

async function skipExperienceSample() {
  sampleLoadingValue.value = null;
  const firstQuestion = selectedQuestions[0];
  const secondQuestion = selectedQuestions[1] ?? selectedQuestions[0];
  try {
    await Promise.all([
      typedIpcRenderer.invoke(
        'createExperienceSample',
        promptedAt,
        firstQuestion.question,
        firstQuestion.labels.join(', '),
        secondQuestion.question,
        secondQuestion.labels.join(', '),
        esConfig.scale,
        undefined,
        undefined,
        true
      ),
      new Promise((resolve) => setTimeout(resolve, 150))
    ]);
    await typedIpcRenderer.invoke('closeExperienceSamplingWindow', true);
  } catch (error) {
    console.error('Error creating experience sample', error);
  }
}
</script>
<template>
  <div class="experience-sampling-notification flex min-h-screen flex-col">
    <div class="notification-top-bar">
      <div>Self-Reflection: {{ studyConfig.name }}</div>
      <div>{{ promptedAtString }}</div>
    </div>
    <div class="pointer-events-auto flex flex-1 flex-row">
      <div class="flex-1 p-4 pt-1">
        <div class="flex-1">
          <p class="text-xs text-gray-400">Self-Reflection {{ questionProgressLabel }}</p>
          <p class="prompt">{{ activeQuestion.question }}</p>
          <div class="-mx-1 mt-2 flex flex-row justify-between">
            <div
              v-for="value in scale"
              :key="value"
              class="sample-answer"
              @click="submitResponse(value)"
            >
              <span v-if="sampleLoadingValue !== value" class="mx-auto flex font-medium">
                {{ value }}
              </span>
              <span v-else class="mx-auto flex font-medium">
                <span class="loading loading-spinner loading-xs" />
              </span>
            </div>
          </div>
          <div class="mt-1 flex flex-row text-sm text-gray-400">
            <div class="basis-1/3">{{ activeQuestion.labels[0] }}</div>
            <div class="basis-1/3 text-center">
              <span v-if="activeQuestion.labels.length === 3">{{ activeQuestion.labels[1] }}</span>
            </div>
            <div class="basis-1/3 text-right">
              {{ activeQuestion.labels[2] || activeQuestion.labels[1] }}
            </div>
          </div>
        </div>
      </div>
      <div class="flex cursor-pointer self-stretch border-l border-gray-200">
        <div
          class="flex w-full items-center justify-center rounded-none border border-transparent px-4 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none"
          @click="skipExperienceSample()"
        >
          <span v-if="sampleLoadingValue !== null" class="w-6"> Skip </span>
          <span v-else class="w-6 font-medium">
            <span class="loading loading-spinner loading-xs" />
          </span>
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
}
</style>
