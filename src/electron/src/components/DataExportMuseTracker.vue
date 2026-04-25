<template>
  <div class="p-4">
    <h3 class="mb-4 text-lg font-semibold">Muse Tracker Data</h3>

    <div class="form-control mb-4">
      <label class="label cursor-pointer">
        <span class="label-text">Share Muse Data</span>
        <input
          type="checkbox"
          class="checkbox"
          :checked="selectedOption === DataExportType.All"
          @change="toggleDataSelection"
        />
      </label>
    </div>

    <div
      class="relative mt-5"
      :class="{
        'cursor-not-allowed overflow-hidden opacity-50': selectedOption === DataExportType.None
      }"
    >
      <div
        v-if="selectedOption === DataExportType.None"
        class="absolute inset-0 z-10 flex items-center justify-center bg-slate-800 bg-opacity-40"
      >
        <p class="bg-slate-800 p-5 text-lg text-white">This data is not being shared</p>
      </div>

      <!-- EEG Data -->
      <div class="mb-2">
        <h4 class="mb-1 text-sm font-semibold">EEG Data</h4>
        <p class="mb-1 text-sm text-base-content/60">Total Data Points: {{ totalDataPoints }}</p>
        <p class="text-xs text-base-content/50">Showing first 100 data points</p>
      </div>

      <div class="max-h-96 w-full overflow-y-auto">
        <table class="table table-sm w-full">
          <thead class="sticky top-0 bg-base-300">
            <tr>
              <th>Timestamp</th>
              <th>TP9 (μV)</th>
              <th>AF7 (μV)</th>
              <th>AF8 (μV)</th>
              <th>TP10 (μV)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in displayedData" :key="index" class="hover">
              <td class="text-xs">{{ formatTimestamp(row.timestamp) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel1_TP9) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel2_AF7) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel3_AF8) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel4_TP10) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Optics Data -->
      <div class="mb-2 mt-6">
        <h4 class="mb-1 text-sm font-semibold">Optics Data</h4>
        <p class="mb-1 text-sm text-base-content/60">Total Data Points: {{ opticsTotalDataPoints }}</p>
        <p class="text-xs text-base-content/50">Showing first 100 data points</p>
      </div>

      <div class="max-h-96 w-full overflow-y-auto">
        <table class="table table-sm w-full">
          <thead class="sticky top-0 bg-base-300">
            <tr>
              <th>Timestamp</th>
              <th>Ch0</th>
              <th>Ch1</th>
              <th>Ch2</th>
              <th>Ch3</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in displayedOpticsData" :key="index" class="hover">
              <td class="text-xs">{{ formatTimestamp(row.timestamp) }}</td>
              <td class="text-xs">{{ formatNumber(row.ch0) }}</td>
              <td class="text-xs">{{ formatNumber(row.ch1) }}</td>
              <td class="text-xs">{{ formatNumber(row.ch2) }}</td>
              <td class="text-xs">{{ formatNumber(row.ch3) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';import { DataExportType } from '../../shared/DataExportType.enum';
import typedIpcRenderer from '../utils/typedIpcRenderer';

interface MuseData {
  id: string;
  timestamp: Date;
  channel1_TP9?: number;
  channel2_AF7?: number;
  channel3_AF8?: number;
  channel4_TP10?: number;
}

interface OpticsData {
  id: number;
  timestamp: Date;
  ch0: number;
  ch1: number;
  ch2: number;
  ch3: number;
}

const props = defineProps<{
  shouldShare: boolean;
}>();

const emit = defineEmits<{
  'update:shouldShare': [value: boolean];
}>();

const selectedOption = ref(props.shouldShare ? DataExportType.All : DataExportType.None);
const data = ref<MuseData[]>([]);
const maxDisplayed = ref(100);
const totalDataPoints = ref(0);

const opticsData = ref<OpticsData[]>([]);
const opticsTotalDataPoints = ref(0);

onMounted(async () => {
  await Promise.all([loadData(), loadOpticsData()]);
});

const displayedData = computed(() => {
  return data.value.slice(0, maxDisplayed.value);
});

const displayedOpticsData = computed(() => {
  return opticsData.value.slice(0, maxDisplayed.value);
});

async function loadData() {
  try {
    const result = await typedIpcRenderer.invoke('muse:get-data-for-export');
    const payload = Array.isArray(result)
      ? { data: result, totalDataPoints: result.length }
      : {
          data: result?.data ?? [],
          totalDataPoints: result?.totalDataPoints ?? 0
        };

    data.value = payload.data.map((d: any) => ({
      ...d,
      timestamp: new Date(d.timestamp)
    }));
    totalDataPoints.value = payload.totalDataPoints;
  } catch (error) {
    console.error('Error loading Muse data for export:', error);
  }
}

async function loadOpticsData() {
  try {
    const result = await typedIpcRenderer.invoke('muse:get-optics-for-export');
    opticsData.value = (result?.data ?? []).map((d: any) => ({
      ...d,
      timestamp: new Date(d.timestamp)
    }));
    opticsTotalDataPoints.value = result?.totalDataPoints ?? 0;
  } catch (error) {
    console.error('Error loading Muse optics data for export:', error);
  }
}

function toggleDataSelection() {
  selectedOption.value =
    selectedOption.value === DataExportType.None ? DataExportType.All : DataExportType.None;
  emit('update:shouldShare', selectedOption.value === DataExportType.All);
}

function formatTimestamp(date: Date): string {
  return new Date(date).toLocaleString();
}

function formatNumber(value: number | undefined | null): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(2);
}
</script>

<style scoped lang="less">
@import '../styles/index';
</style>
