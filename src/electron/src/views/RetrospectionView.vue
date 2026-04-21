<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Activity,
  ActivitySessions,
  ChartDataPoint,
  DataPointType,
  TimeActive
} from '../utils/retrospection/types';
import { ACTIVITY_LABELS, getTailwindClassFromActivity } from '../utils/retrospection/utils';
import StackedBarChart from '../components/StackedBarChart.vue';

// @ts-ignore
const typedIpcRenderer = window.ipcRenderer;
const isLoading = ref(false);
const selectedDay = ref(new Date());
const allWindowActivities = ref<ActivitySessions[]>([]);
const chartDataWindowActivities = ref<ChartDataPoint[]>();
const longestTimeActive = ref<TimeActive | undefined>(undefined);
const topApps = ref<ActivitySessions[] | undefined>(undefined);
const topActivities = ref<ActivitySessions[]>([]);

const earliestUserComputerActivity = computed((): number => {
  return (
    chartDataWindowActivities.value?.reduce((acc, activity) => {
      if (activity.start.getTime() < acc) {
        return activity.start.getTime();
      }
      return acc;
    }, Number.MAX_SAFE_INTEGER) ?? Number.MAX_SAFE_INTEGER
  );
});

const latestUserComputerActivity = computed((): number => {
  return (
    chartDataWindowActivities.value?.reduce((acc, activity) => {
      if (!activity.end) {
        return Date.now();
      }
      if (activity.end.getTime() > acc) {
        return activity.end.getTime();
      }
      return acc;
    }, 0) ?? 0
  );
});

onMounted(async () => {
  await loadData();
});

async function loadData() {
  isLoading.value = true;
  await loadLongestTimeActive();
  await loadMostActiveApps();
  await loadWindowActivities();
  isLoading.value = false;
}

function windowActivitiesToChartData() {
  const dataPoints: ChartDataPoint[] = [];

  allWindowActivities.value?.forEach((activitySession: ActivitySessions) => {
    activitySession.sessions.forEach((session: TimeActive) => {
      dataPoints.push({
        type: DataPointType.WINDOW_ACTIVITY,
        activity: activitySession.type as Activity,
        start: session.from,
        end: session.to,
        color: getTailwindClassFromActivity(activitySession.type)
      });
    });
  });

  chartDataWindowActivities.value = dataPoints;
}

async function loadWindowActivities() {
  allWindowActivities.value = (await typedIpcRenderer.invoke(
    'retrospectionGetActivities',
    selectedDay.value
  )) as ActivitySessions[];
  windowActivitiesToChartData();
  topActivities.value =
    allWindowActivities.value
      ?.sort((a: ActivitySessions, b: ActivitySessions) => b.totalDurationMs - a.totalDurationMs)
      .slice(0, 3) ?? [];
}

async function loadLongestTimeActive() {
  try {
    longestTimeActive.value = (await typedIpcRenderer.invoke(
      'retrospectionLoadLongestTimeActive',
      selectedDay.value
    )) as TimeActive;
  } catch (error) {
    console.error('Error loading longest time active', error);
  }
}

async function loadMostActiveApps() {
  try {
    topApps.value = (await typedIpcRenderer.invoke(
      'retrospectionGetTopThreeMostActiveApps',
      selectedDay.value
    )) as ActivitySessions[];
  } catch (error) {
    console.error('Error loading most active apps', error);
  }
}

function msToMinutes(ms: number): number {
  return Math.round(ms / 60000);
}

function renderTime(ms: number): string {
  let minutes = msToMinutes(ms);
  if (minutes < 60) {
    return `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  minutes = minutes % 60;
  if (minutes === 0) {
    if (hours === 1) {
      return `${hours} hour`;
    } else {
      return `${hours} hours`;
    }
  } else {
    const fractionalHours = Math.round((minutes / 60) * 10) / 10;
    return `${hours + fractionalHours} hours`;
  }
}

async function handleDayChange(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (!value) return;
  selectedDay.value = new Date(value);
  await loadData();
}

function getNearestFullHourTime(time: number, offset: number): number {
  const nextFullHour = new Date(time);
  nextFullHour.setHours(nextFullHour.getHours() + offset, 0, 0, 0);
  return nextFullHour.getTime();
}

function getTimeString(date: Date | string | number): string {
  const d = new Date(date);
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getDayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  ) {
    return 'Today';
  } else if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
</script>

<template>
  <!-- No data for this day -->
  <template v-if="!allWindowActivities || allWindowActivities.length === 0">
    <div class="flex h-screen items-center justify-center">
      <!-- day picker -->
      <div class="absolute right-6 top-6 z-10">
        <input
          type="date"
          :value="selectedDay.toISOString().substring(0, 10)"
          :max="new Date().toISOString().substring(0, 10)"
          class="rounded border border-gray-300 bg-white px-2 py-1 text-gray-800 dark:border-neutral-600 dark:bg-neutral-700 dark:text-slate-200"
          style="min-width: 140px"
          @change="handleDayChange"
        />
      </div>
      <div class="text-center text-gray-800 dark:text-gray-200">
        <h1 class="mb-8 text-2xl font-bold">No data for this day.</h1>
        <span class="text-gray-600 dark:text-gray-400"
          >There is no data recorded for this date. Please select a different day.</span
        >
      </div>
    </div>
  </template>

  <!-- Retrospection dashboard -->
  <template v-else>
    <div class="view flex h-screen flex-col overflow-y-auto">
      <!-- day picker -->
      <div class="absolute right-6 top-6 z-10">
        <input
          type="date"
          :value="selectedDay.toISOString().substring(0, 10)"
          :max="new Date().toISOString().substring(0, 10)"
          class="rounded border border-gray-300 bg-white px-2 py-1 text-gray-800 dark:border-neutral-600 dark:bg-neutral-700 dark:text-slate-200"
          style="min-width: 140px"
          @change="handleDayChange"
        />
      </div>

      <div>
        <h1 class="primary-blue mb-3 text-2xl font-bold">
          {{ getDayLabel(selectedDay) }} - in Review
        </h1>
        <div class="subline mb-8 text-gray-600 dark:text-gray-400">
          Take a moment to reflect on your workday.
        </div>

        <!-- Timeline Visualization -->
        <h1 class="mb-2 mt-8 text-xl font-bold text-gray-900 dark:text-gray-100">
          Activities over time
        </h1>
        <StackedBarChart
          v-if="!isLoading && chartDataWindowActivities"
          :data="chartDataWindowActivities"
          :start-date="getNearestFullHourTime(earliestUserComputerActivity, 0)"
          :end-date="getNearestFullHourTime(latestUserComputerActivity, 1)"
          type="WINDOW_ACTIVITY"
        />

        <!-- Info Tiles -->
        <h1 class="mb-2 mt-8 text-xl font-bold text-gray-900 dark:text-gray-100">
          Insights of your day
        </h1>
        <div class="tile-grid">
          <!-- Tile 1: Longest active period -->
          <div
            v-if="longestTimeActive"
            class="rounded border border-gray-200 bg-gray-100 px-4 py-3 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-slate-200"
          >
            <h2 class="primary-blue font-bold leading-4">Longest active period</h2>
            <p class="mt-2">
              Your longest active streak was
              <b>{{ renderTime(longestTimeActive!.duration * 60000) }}</b> (between
              {{ getTimeString(longestTimeActive!.from) }} and
              {{ getTimeString(longestTimeActive!.to) }}).
            </p>
          </div>

          <!-- Tile 2: Active hours -->
          <div
            v-if="topActivities"
            class="rounded border border-gray-200 bg-gray-100 px-4 py-3 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-slate-200"
          >
            <h2 class="primary-blue font-bold leading-4">Active hours on computer</h2>
            <p class="mt-2">
              You were active for
              <b>{{ renderTime(latestUserComputerActivity - earliestUserComputerActivity) }}</b>
              (between {{ getTimeString(earliestUserComputerActivity) }} and
              {{ getTimeString(latestUserComputerActivity) }}).
            </p>
          </div>

          <!-- Tile 3: Top apps -->
          <div
            v-if="topApps"
            class="rounded border border-gray-200 bg-gray-100 px-4 py-3 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-slate-200"
          >
            <h2 class="primary-blue font-bold leading-4">Top apps</h2>
            <ol class="mt-2 list-decimal pl-4">
              <li v-for="(appSession, index) in topApps" :key="index">
                {{ appSession.type }}: {{ renderTime(appSession.totalDurationMs) }}
              </li>
            </ol>
          </div>

          <!-- Tile 4: Top activities -->
          <div
            v-if="topActivities"
            class="rounded border border-gray-200 bg-gray-100 px-4 py-3 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-slate-200"
          >
            <h2 class="primary-blue font-bold leading-4">Top activities pursued</h2>
            <ol class="mt-2 list-decimal pl-4">
              <li v-for="(activitySession, index) in topActivities" :key="index">
                {{ ACTIVITY_LABELS[activitySession.type] || 'Other' }}:
                {{ renderTime(activitySession.totalDurationMs) }}
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<style lang="less" scoped>
@import '../styles/index';

h2.primary-blue {
  color: @primary-color;
}

.primary-blue {
  color: @primary-color;
}

.view {
  padding: 25px;
}

.tile-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.2rem;
  width: 100%;
}
</style>
