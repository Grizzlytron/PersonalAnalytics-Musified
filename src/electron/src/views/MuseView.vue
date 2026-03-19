<template>
  <div class="flex h-full w-full flex-col bg-base-100">
    <!-- Header -->
    <div class="border-b border-base-300 bg-base-200 p-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold">🧠 Muse Tracker</h1>
          <p class="text-sm text-base-content/60">Real-time Muse EEG data</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="badge badge-lg" :class="isTrackerRunning ? 'badge-success' : 'badge-error'">
            {{ isTrackerRunning ? '● Active' : '○ Inactive' }}
          </div>
          <div v-if="connectedDevice" class="badge badge-info badge-lg">
            🔋 {{ connectedDevice.battery || 0 }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs-boxed tabs gap-2 bg-base-200 px-4 py-2">
      <a
        class="tab-lg tab"
        :class="{ 'tab-active': activeTab === 'connection' }"
        @click="activeTab = 'connection'"
      >
        🔌 Connection & Controls
      </a>
      <a
        class="tab-lg tab"
        :class="{ 'tab-active': activeTab === 'eeg' }"
        @click="activeTab = 'eeg'"
      >
        📊 EEG Data
      </a>
      <a
        class="tab-lg tab"
        :class="{ 'tab-active': activeTab === 'quality' }"
        @click="activeTab = 'quality'"
      >
        ✅ Data Quality
      </a>
    </div>

    <!-- Tab Content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden p-3 lg:p-4">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex h-full items-center justify-center">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <!-- Connection Tab -->
      <div v-else-if="activeTab === 'connection'" class="flex flex-col gap-3 pb-2">
        <!-- Status Cards -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="stat min-w-0 overflow-hidden rounded-xl bg-base-200 shadow">
            <div class="stat-figure text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div class="stat-title">Status</div>
            <div
              class="stat-value truncate text-base sm:text-lg"
              :class="isTrackerRunning ? 'text-success' : 'text-error'"
            >
              {{ isTrackerRunning ? 'Active' : 'Inactive' }}
            </div>
          </div>
          <div class="stat min-w-0 overflow-hidden rounded-xl bg-base-200 shadow">
            <div class="stat-figure text-accent">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div class="stat-title">Tracked Minutes</div>
            <div class="stat-value truncate text-base sm:text-lg">
              {{ Math.floor(trackedMinutes).toLocaleString() }}
            </div>
          </div>
          <div class="stat min-w-0 overflow-hidden rounded-xl bg-base-200 shadow">
            <div class="stat-figure text-info">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div class="stat-title">Signal Quality</div>
            <div
              class="stat-value truncate text-base sm:text-lg"
              :class="connectedDevice ? signalQualityColor : ''"
            >
              {{ connectedDevice ? signalQualityLabel : '--' }}
            </div>
          </div>
        </div>

        <!-- Device Discovery Card -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body p-3">
            <h3 class="card-title text-base">🔍 Discover & Connect</h3>
            <div class="flex flex-1 flex-col justify-between gap-3">
              <div>
                <p class="mb-2 text-xs text-base-content/60">Available Devices:</p>
                <div v-if="availableDevices.length > 0" class="max-h-36 space-y-2 overflow-y-auto pr-1">
                  <div
                    v-for="device in availableDevices"
                    :key="device.macAddress"
                    class="flex cursor-pointer items-center gap-2 rounded-lg bg-base-100 p-2 hover:bg-base-300"
                    @click="selectDevice(device)"
                  >
                    <input
                      type="radio"
                      :name="'device-select'"
                      :value="device.macAddress"
                      v-model="selectedDeviceMac"
                      class="radio radio-xs"
                    />
                    <span class="flex-1 truncate text-sm">{{ device.name }}</span>
                    <span class="text-[11px] text-base-content/60">{{ device.rssi }} dBm</span>
                  </div>
                </div>
                <div v-else-if="connectedDevice" class="py-2 text-center text-xs text-success">
                  <p>✓ Device connected: {{ connectedDevice.name }}</p>
                </div>
                <div v-else class="space-y-1 py-2 text-center text-xs text-base-content/50">
                  <p v-if="isTrackerRunning">
                    <span class="loading loading-spinner loading-xs"></span> Scanning for devices...
                  </p>
                  <p v-else class="text-base-content/60">Start tracking to scan</p>
                  <p class="text-base-content/40">Make sure your Muse device is in pairing mode</p>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <button
                  @click="connectToSelectedDevice"
                  :disabled="!selectedDeviceMac || isConnecting || !!connectedDevice"
                  class="btn btn-success btn-sm w-full gap-2"
                >
                  <svg
                    v-if="!isConnecting"
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.658 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                  <span v-if="isConnecting" class="loading loading-spinner loading-xs"></span>
                  {{ isConnecting ? 'Connecting...' : 'Connect' }}
                </button>
                <button
                  @click="disconnectDevice"
                  :disabled="!connectedDevice"
                  class="btn btn-error btn-sm w-full gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.658 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Controls Row -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body py-3">
            <h3 class="card-title">🎮 Controls</h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                @click="startTracking"
                :disabled="isTrackerRunning"
                class="btn btn-primary btn-sm gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Start Tracking
              </button>
              <button
                @click="stopTracking"
                :disabled="!isTrackerRunning"
                class="btn btn-secondary btn-sm gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                  />
                </svg>
                Stop Tracking
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- EEG Data Tab -->
      <div v-else-if="activeTab === 'eeg'" class="flex flex-col gap-4 pb-4">
        <!-- EEG Chart -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body flex flex-col">
            <div class="flex items-center justify-between">
              <h3 class="card-title">📊 Real-time EEG Channels</h3>
              <div class="flex flex-wrap items-center gap-2">
                <span class="badge badge-primary">TP9 (Left Ear)</span>
                <span class="badge badge-secondary">AF7 (Left Forehead)</span>
                <span class="badge badge-accent">AF8 (Right Forehead)</span>
                <span class="badge badge-info">TP10 (Right Ear)</span>
              </div>
            </div>
            <div class="h-96">
              <Line
                v-if="eegChartData.datasets.length > 0"
                :data="eegChartData"
                :options="eegChartOptions"
                class="h-full"
              />
              <div v-else class="flex h-full items-center justify-center text-base-content/60">
                <div class="text-center">
                  <div class="mb-4 text-6xl">📡</div>
                  <p>No EEG data available</p>
                  <p class="text-sm">Connect a Muse device to start streaming</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- EEG Data Table -->
        <div class="card h-64 bg-base-200 shadow-xl">
          <div class="card-body p-4">
            <h3 class="card-title text-sm">📋 Recent EEG Readings</h3>
            <div v-if="latestData.length === 0" class="flex flex-1 items-center justify-center">
              <p class="text-sm text-base-content/60">No data available yet</p>
            </div>
            <div v-else class="flex-1 overflow-auto">
              <table class="table table-xs w-full">
                <thead class="sticky top-0 bg-base-300">
                  <tr>
                    <th>Time</th>
                    <th>TP9</th>
                    <th>AF7</th>
                    <th>AF8</th>
                    <th>TP10</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="data in latestData.slice(-10)" :key="data.id" class="hover">
                    <td>{{ formatTimestamp(data.timestamp) }}</td>
                    <td>{{ formatNumber(data.channel1_TP9) }}</td>
                    <td>{{ formatNumber(data.channel2_AF7) }}</td>
                    <td>{{ formatNumber(data.channel3_AF8) }}</td>
                    <td>{{ formatNumber(data.channel4_TP10) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Data Quality Tab -->
      <div v-else-if="activeTab === 'quality'" class="flex flex-col gap-4 pb-4">
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body">
            <h3 class="card-title">Signal Quality Metadata</h3>
            <p class="text-sm text-base-content/60">
              Battery and HSI quality values for the current EEG session are shown below.
            </p>
            <div class="mt-2 grid grid-cols-2 gap-3">
              <div class="rounded-lg bg-base-100 p-3">
                <div class="text-xs text-base-content/60">Battery</div>
                <div class="text-lg font-semibold">{{ connectedDevice?.battery ?? 0 }}%</div>
              </div>
              <div class="rounded-lg bg-base-100 p-3">
                <div class="text-xs text-base-content/60">Overall Quality</div>
                <div class="text-lg font-semibold" :class="signalQualityColor">
                  {{ signalQualityLabel }}
                </div>
              </div>
              <div class="rounded-lg bg-base-100 p-3">
                <div class="text-xs text-base-content/60">HSI TP9</div>
                <div class="text-lg font-semibold">{{ latestQualitySample?.hsiTp9 ?? 'N/A' }}</div>
              </div>
              <div class="rounded-lg bg-base-100 p-3">
                <div class="text-xs text-base-content/60">HSI AF7</div>
                <div class="text-lg font-semibold">{{ latestQualitySample?.hsiAf7 ?? 'N/A' }}</div>
              </div>
              <div class="rounded-lg bg-base-100 p-3">
                <div class="text-xs text-base-content/60">HSI AF8</div>
                <div class="text-lg font-semibold">{{ latestQualitySample?.hsiAf8 ?? 'N/A' }}</div>
              </div>
              <div class="rounded-lg bg-base-100 p-3">
                <div class="text-xs text-base-content/60">HSI TP10</div>
                <div class="text-lg font-semibold">{{ latestQualitySample?.hsiTp10 ?? 'N/A' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import typedIpcRenderer from '../utils/typedIpcRenderer';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'vue-chartjs';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface MuseData {
  id: string;
  timestamp: Date;
  channel1_TP9?: number;
  channel2_AF7?: number;
  channel3_AF8?: number;
  channel4_TP10?: number;
  batteryLevel?: number;
  signalQuality?: number;
  hsiTp9?: number;
  hsiAf7?: number;
  hsiAf8?: number;
  hsiTp10?: number;
  connectionState?: string;
}

interface ConnectedDevice {
  name: string;
  signalQuality?: number | null;
  battery: number;
}

const isTrackerRunning = ref(false);
const connectedDevice = ref<ConnectedDevice | null>(null);
const latestData = ref<MuseData[]>([]);
const trackedMinutes = ref(0);
const activeTab = ref<'connection' | 'eeg' | 'quality'>('connection');
const isLoading = ref(true);
const discoveredDevices = ref<Array<{ name: string; macAddress: string; rssi: number }>>([]);
const selectedDeviceMac = ref<string>('');
const isConnecting = ref(false);
const eegWindowAnchorMs = ref<number | null>(null);
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let lastDataHash = ''; // track whether EEG data actually changed

const CHART_PAGE_SECONDS = 30;
const EEG_REFRESH_MS = 2000;
const NON_EEG_REFRESH_MS = 8000;

// Filter out connected device from discovered devices list
const availableDevices = computed(() => {
  if (!connectedDevice.value) {
    return discoveredDevices.value;
  }
  return discoveredDevices.value.filter((d) => d.name !== connectedDevice.value?.name);
});

const latestQualitySample = computed(() => {
  if (latestData.value.length === 0) return null;
  return latestData.value[latestData.value.length - 1];
});

// Signal quality descriptive labels (HSI: 1=good, 2=mediocre, 4=poor)
const signalQualityLabel = computed(() => {
  const q = connectedDevice.value?.signalQuality;
  if (q === null || q === undefined || q <= 0) return 'N/A';
  if (q <= 1) return 'Good';
  if (q <= 2) return 'Mediocre';
  return 'Poor';
});

const signalQualityColor = computed(() => {
  const q = connectedDevice.value?.signalQuality;
  if (q === null || q === undefined || q <= 0) return 'text-base-content/50';
  if (q <= 1) return 'text-success';
  if (q <= 2) return 'text-warning';
  return 'text-error';
});

const signalQualityProgressClass = computed(() => {
  const q = connectedDevice.value?.signalQuality;
  if (q === null || q === undefined || q <= 0) return 'progress-neutral';
  if (q <= 1) return 'progress-success';
  if (q <= 2) return 'progress-warning';
  return 'progress-error';
});

const eegWindowState = computed(() => {
  const dataSorted = [...latestData.value].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  if (dataSorted.length === 0) {
    return {
      anchorTs: Date.now(),
      latestTs: Date.now(),
      elapsedMs: 0,
      isRolling: false
    };
  }

  const firstTs = new Date(dataSorted[0].timestamp).getTime();
  const latestTs = new Date(dataSorted[dataSorted.length - 1].timestamp).getTime();
  const anchorTs = eegWindowAnchorMs.value ?? firstTs;
  const elapsedMs = Math.max(0, latestTs - anchorTs);
  const isRolling = elapsedMs >= CHART_PAGE_SECONDS * 1000;

  return {
    anchorTs,
    latestTs,
    elapsedMs,
    isRolling
  };
});

const eegWindowIsRolling = computed(() => eegWindowState.value.isRolling);

// Chart data for EEG
const eegChartData = computed(() => {
  const dataSorted = [...latestData.value].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (dataSorted.length === 0) {
    return { labels: [], datasets: [] };
  }

  const pageMs = CHART_PAGE_SECONDS * 1000;
  const latestTs = eegWindowState.value.latestTs;
  const anchorTs = eegWindowState.value.anchorTs;
  const pageStartTs = eegWindowIsRolling.value ? latestTs - pageMs : anchorTs;

  const pageData = dataSorted.filter((d) => {
    const ts = new Date(d.timestamp).getTime();
    return ts >= pageStartTs && ts <= latestTs;
  });

  const toPoint = (timestamp: Date, value: number | undefined) => ({
    x: (new Date(timestamp).getTime() - pageStartTs) / 1000,
    y: value ?? 0
  });

  return {
    labels: [],
    datasets:
      pageData.length > 0
        ? [
            {
              label: 'TP9 (Left Ear)',
              data: pageData.map((d) => toPoint(d.timestamp, d.channel1_TP9)),
              borderColor: 'rgb(99, 102, 241)',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            },
            {
              label: 'AF7 (Left Forehead)',
              data: pageData.map((d) => toPoint(d.timestamp, d.channel2_AF7)),
              borderColor: 'rgb(236, 72, 153)',
              backgroundColor: 'rgba(236, 72, 153, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            },
            {
              label: 'AF8 (Right Forehead)',
              data: pageData.map((d) => toPoint(d.timestamp, d.channel3_AF8)),
              borderColor: 'rgb(34, 211, 238)',
              backgroundColor: 'rgba(34, 211, 238, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            },
            {
              label: 'TP10 (Right Ear)',
              data: pageData.map((d) => toPoint(d.timestamp, d.channel4_TP10)),
              borderColor: 'rgb(74, 222, 128)',
              backgroundColor: 'rgba(74, 222, 128, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            }
          ]
        : []
  };
});

const eegChartOptions = computed(() => {
  const values = latestData.value
    .slice(-300)
    .flatMap((d) => [d.channel1_TP9, d.channel2_AF7, d.channel3_AF8, d.channel4_TP10])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const minVal = values.length > 0 ? Math.min(...values) : undefined;
  const maxVal = values.length > 0 ? Math.max(...values) : undefined;
  const range =
    minVal !== undefined && maxVal !== undefined ? Math.max(10, (maxVal - minVal) * 0.2) : undefined;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: connectedDevice.value ? { duration: 0 } : (false as const),
    scales: {
      x: {
        type: 'linear' as const,
        min: 0,
        max: CHART_PAGE_SECONDS,
        display: true,
        title: { display: true, text: 'Elapsed Window Time (s)' },
        ticks: {
          stepSize: 5,
          callback: (value: any) => {
            const seconds = Number(value);
            if (Number.isNaN(seconds)) return '';
            return `${Math.round(seconds)}s`;
          },
          maxTicksLimit: 8
        }
      },
      y: {
        display: true,
        title: { display: true, text: 'Amplitude (uV)' },
        suggestedMin: minVal !== undefined && range !== undefined ? minVal - range : undefined,
        suggestedMax: maxVal !== undefined && range !== undefined ? maxVal + range : undefined
      }
    },
    plugins: {
      legend: { display: true, position: 'top' as const },
      tooltip: { enabled: true }
    }
  };
});

onMounted(async () => {
  await loadData();
  isLoading.value = false;
  startPolling();
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

watch(activeTab, async () => {
  if (activeTab.value === 'eeg') {
    // Start a fresh visible timeline when opening EEG tab.
    eegWindowAnchorMs.value = Date.now();
  }
  // Immediately refresh when switching tabs, then adjust poll cadence.
  await loadData();
  startPolling();
});

function startPolling() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  const intervalMs = activeTab.value === 'eeg' ? EEG_REFRESH_MS : NON_EEG_REFRESH_MS;
  refreshInterval = setInterval(loadData, intervalMs);
}

async function loadData() {
  try {
    const includeDenseData = activeTab.value === 'eeg';
    const data = await typedIpcRenderer.invoke('muse:get-tracker-status', includeDenseData);
    if (data) {
      isTrackerRunning.value = data.isRunning;
      connectedDevice.value = data.connectedDevice || null;
      trackedMinutes.value = data.trackedMinutes || 0;

      // Only update latestData when the data actually changed to avoid
      // unnecessary Chart.js re-renders that cause freezes
      const incoming = data.latestData || [];
      const newHash =
        incoming.length > 0
          ? `${incoming.length}-${incoming[0]?.id}-${incoming[incoming.length - 1]?.id}`
          : '0';
      if (newHash !== lastDataHash) {
        lastDataHash = newHash;
        const mapped = incoming.map((d: any) => ({
          ...d,
          timestamp: new Date(d.timestamp)
        }));
        latestData.value = mapped;

        if (activeTab.value === 'eeg' && mapped.length > 0 && eegWindowAnchorMs.value === null) {
          eegWindowAnchorMs.value = new Date(mapped[0].timestamp).getTime();
        }
      }

    }

    // Discovery list is only needed on the connection tab.
    if (activeTab.value === 'connection' && data?.isRunning && !data?.connectedDevice) {
      try {
        const devices = await typedIpcRenderer.invoke('muse:get-discovered-devices');
        discoveredDevices.value = devices || [];
      } catch (err) {
        console.warn('Error loading discovered devices:', err);
      }
    } else if (activeTab.value !== 'connection') {
      discoveredDevices.value = [];
    }
  } catch (error) {
    console.error('Error loading Muse data:', error);
  }
}

async function startTracking() {
  try {
    await typedIpcRenderer.invoke('muse:start-tracker');
    isTrackerRunning.value = true;
    eegWindowAnchorMs.value = Date.now();
  } catch (error) {
    console.error('Error starting tracker:', error);
  }
}

async function stopTracking() {
  try {
    await typedIpcRenderer.invoke('muse:stop-tracker');
    isTrackerRunning.value = false;
    eegWindowAnchorMs.value = null;
  } catch (error) {
    console.error('Error stopping tracker:', error);
  }
}

function selectDevice(device: any) {
  selectedDeviceMac.value = device.macAddress;
}

async function connectToSelectedDevice() {
  if (!selectedDeviceMac.value) return;

  isConnecting.value = true;
  try {
    await typedIpcRenderer.invoke('muse:connect-device', selectedDeviceMac.value);
    // Refresh data to show connected device
    await loadData();
    // Clear selection since device is now connected
    selectedDeviceMac.value = '';
  } catch (error) {
    console.error('Error connecting to device:', error);
  } finally {
    isConnecting.value = false;
  }
}

async function disconnectDevice() {
  try {
    await typedIpcRenderer.invoke('muse:disconnect-device');
    // Immediately clear connected device in UI
    connectedDevice.value = null;
    selectedDeviceMac.value = '';
    // Refresh data to sync with backend
    await loadData();
  } catch (error) {
    console.error('Error disconnecting device:', error);
  }
}

function formatTimestamp(date: Date): string {
  const d = new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatNumber(value: number | undefined | null): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(2);
}
</script>

<style scoped lang="less">
@import '../styles/index';
</style>
