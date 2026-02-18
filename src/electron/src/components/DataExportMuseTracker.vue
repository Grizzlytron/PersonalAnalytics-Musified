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

      <div class="mb-4">
        <p class="mb-2 text-sm text-base-content/60">Total Data Points: {{ totalDataPoints }}</p>
      </div>

      <div class="max-h-96 w-full overflow-y-auto">
        <table class="table table-sm w-full">
          <thead class="sticky top-0 bg-base-300">
            <tr>
              <th>Timestamp</th>
              <th>Device</th>
              <th>TP9 (μV)</th>
              <th>AF7 (μV)</th>
              <th>AF8 (μV)</th>
              <th>TP10 (μV)</th>
              <th>Signal Quality</th>
              <th>Battery</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in displayedData" :key="index" class="hover">
              <td class="text-xs">{{ formatTimestamp(row.timestamp) }}</td>
              <td class="text-xs">{{ row.deviceName }}</td>
              <td class="text-xs">{{ formatNumber(row.channel1_TP9) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel2_AF7) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel3_AF8) }}</td>
              <td class="text-xs">{{ formatNumber(row.channel4_TP10) }}</td>
              <td>
                <span
                  class="badge badge-sm"
                  :class="{
                    'badge-success': row.signalQuality !== undefined && row.signalQuality >= 3,
                    'badge-warning': row.signalQuality === 2,
                    'badge-error': row.signalQuality !== undefined && row.signalQuality < 2
                  }"
                >
                  {{ row.signalQuality ?? 'N/A' }}/4
                </span>
              </td>
              <td class="text-xs">{{ row.batteryLevel }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="data.length > maxDisplayed" class="mt-2 text-center text-sm text-base-content/60">
        Showing {{ maxDisplayed }} of {{ data.length }} records
      </div>
    </div>

    <div class="mt-4 rounded-lg bg-base-100 p-4">
      <h4 class="mb-2 text-sm font-semibold">Data Summary</h4>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span class="text-base-content/60">Connected Devices:</span>
          <span class="font-semibold">{{ uniqueDevices }}</span>
        </div>
        <div>
          <span class="text-base-content/60">Date Range:</span>
          <span class="font-semibold">{{ dateRange }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { DataExportType } from '../../shared/DataExportType.enum';
import typedIpcRenderer from '../utils/typedIpcRenderer';

interface MuseData {
  id: string;
  deviceId: string;
  deviceName: string;
  timestamp: Date;
  channel1_TP9?: number;
  channel2_AF7?: number;
  channel3_AF8?: number;
  channel4_TP10?: number;
  ppg?: number;
  batteryLevel?: number;
  signalQuality?: number;
  connectionState?: string;
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

onMounted(async () => {
  await loadData();
});

const displayedData = computed(() => {
  return data.value.slice(0, maxDisplayed.value);
});

const totalDataPoints = computed(() => {
  return data.value.length;
});

const uniqueDevices = computed(() => {
  const devices = new Set(data.value.map((d) => d.deviceId));
  return devices.size;
});

const dateRange = computed(() => {
  if (data.value.length === 0) return 'No data';
  const sorted = [...data.value].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const start = formatTimestamp(sorted[0].timestamp);
  const end = formatTimestamp(sorted[sorted.length - 1].timestamp);
  return `${start} - ${end}`;
});

async function loadData() {
  try {
    const result = await typedIpcRenderer.invoke('muse:get-data-for-export');
    data.value = (result || []).map((d: any) => ({
      ...d,
      timestamp: new Date(d.timestamp)
    }));
  } catch (error) {
    console.error('Error loading Muse data for export:', error);
  }
}

function toggleDataSelection() {
  selectedOption.value =
    selectedOption.value === DataExportType.None ? DataExportType.All : DataExportType.None;
  emit('update:shouldShare', selectedOption.value === DataExportType.All);
}

function formatTimestamp(date: Date): string {
  const d = new Date(date);
  return d.toLocaleString('en-US');
}

function formatNumber(value: number | undefined | null): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(2);
}
</script>

<style scoped lang="less">
@import '../styles/index';
</style>
