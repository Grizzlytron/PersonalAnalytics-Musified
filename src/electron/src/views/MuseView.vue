<template>
  <div class="flex h-full w-full flex-col bg-base-100">
    <!-- Header -->
    <div class="border-b border-base-300 bg-base-200 p-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold">🧠 Muse Tracker</h1>
          <p class="text-sm text-base-content/60">
            Real-time EEG and PPG data from your Muse S device
          </p>
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
        :class="{ 'tab-active': activeTab === 'ppg' }"
        @click="activeTab = 'ppg'"
      >
        ❤️ Heart Rate
      </a>
    </div>

    <!-- Tab Content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden p-4">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex h-full items-center justify-center">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <!-- Connection Tab -->
      <div v-else-if="activeTab === 'connection'" class="flex flex-col gap-4 pb-4">
        <!-- Status Cards -->
        <div class="grid grid-cols-4 gap-4">
          <div class="stat rounded-xl bg-base-200 shadow">
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
              class="stat-value text-lg"
              :class="isTrackerRunning ? 'text-success' : 'text-error'"
            >
              {{ isTrackerRunning ? 'Active' : 'Inactive' }}
            </div>
          </div>
          <div class="stat rounded-xl bg-base-200 shadow">
            <div class="stat-figure text-secondary">
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
                  d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div class="stat-title">Device</div>
            <div class="stat-value text-lg">{{ connectedDevice ? '1' : '0' }}</div>
          </div>
          <div class="stat rounded-xl bg-base-200 shadow">
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
            <div class="stat-title">Data Points</div>
            <div class="stat-value text-lg">{{ totalDataPoints }}</div>
          </div>
          <div class="stat rounded-xl bg-base-200 shadow">
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
            <div class="stat-value text-lg" :class="connectedDevice ? signalQualityColor : ''">
              {{ connectedDevice ? signalQualityLabel : '--' }}
            </div>
          </div>
        </div>

        <!-- Device & Controls Row -->
        <div class="grid grid-cols-2 gap-4">
          <!-- Device Discovery Card -->
          <div class="card bg-base-200 shadow-xl">
            <div class="card-body">
              <h3 class="card-title">🔍 Discover & Connect</h3>
              <div class="flex flex-1 flex-col justify-between gap-4">
                <div>
                  <p class="mb-3 text-sm text-base-content/60">Available Devices:</p>
                  <div v-if="availableDevices.length > 0" class="space-y-2">
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
                        class="radio radio-sm"
                      />
                      <span class="flex-1">{{ device.name }}</span>
                      <span class="text-xs text-base-content/60">{{ device.rssi }} dBm</span>
                    </div>
                  </div>
                  <div v-else-if="connectedDevice" class="py-4 text-center text-sm text-success">
                    <p>✓ Device connected</p>
                  </div>
                  <div v-else class="space-y-2 py-4 text-center text-sm text-base-content/40">
                    <p v-if="isTrackerRunning">
                      <span class="loading loading-spinner loading-sm"></span> Scanning for
                      devices...
                    </p>
                    <p v-else class="text-base-content/60">Start tracking to scan</p>
                    <p class="mt-2 text-xs text-base-content/30">
                      Make sure your Muse device is in pairing mode
                    </p>
                  </div>
                </div>
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
              </div>
            </div>
          </div>

          <!-- Connected Device Card -->
          <div class="card bg-base-200 shadow-xl">
            <div class="card-body">
              <h3 class="card-title">🎧 Connected Device</h3>
              <div v-if="connectedDevice" class="flex-1 space-y-4">
                <div class="rounded-lg bg-base-100 p-4">
                  <div class="mb-3 flex items-center justify-between">
                    <span class="font-semibold">Device Name</span>
                    <span class="font-mono text-primary">{{ connectedDevice.name }}</span>
                  </div>
                  <div class="space-y-3">
                    <div>
                      <div class="mb-1 flex justify-between text-sm">
                        <span>Signal Quality</span>
                        <span :class="signalQualityColor">{{ signalQualityLabel }}</span>
                      </div>
                      <progress
                        :value="
                          connectedDevice.signalQuality === 1
                            ? 4
                            : connectedDevice.signalQuality === 2
                              ? 2
                              : 0
                        "
                        max="4"
                        class="progress w-full"
                        :class="signalQualityProgressClass"
                      ></progress>
                    </div>
                    <div>
                      <div class="mb-1 flex justify-between text-sm">
                        <span>Battery Level</span>
                        <span>{{ connectedDevice.battery || 0 }}%</span>
                      </div>
                      <progress
                        :value="connectedDevice.battery || 0"
                        max="100"
                        class="progress progress-success w-full"
                      ></progress>
                    </div>
                  </div>
                </div>
                <button @click="disconnectDevice" class="btn btn-error btn-sm w-full gap-2">
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
              <div v-else class="flex flex-1 items-center justify-center">
                <div class="text-center">
                  <div class="mb-4 text-6xl">🔍</div>
                  <p class="text-base-content/60">No device connected</p>
                  <p class="text-sm text-base-content/40">Start tracking to scan for devices</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Controls Card -->
          <div class="card bg-base-200 shadow-xl">
            <div class="card-body">
              <h3 class="card-title">🎮 Controls</h3>
              <div class="flex flex-1 flex-col justify-center gap-4">
                <button
                  @click="startTracking"
                  :disabled="isTrackerRunning"
                  class="btn btn-primary btn-lg gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-6 w-6"
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
                  class="btn btn-secondary btn-lg gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-6 w-6"
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
                <button @click="refreshData" class="btn btn-outline btn-lg gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Refresh Data
                </button>
              </div>
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
              <div class="flex flex-wrap gap-2">
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
                    <th>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="data in latestData.slice(0, 10)" :key="data.id" class="hover">
                    <td>{{ formatTimestamp(data.timestamp) }}</td>
                    <td>{{ formatNumber(data.channel1_TP9) }}</td>
                    <td>{{ formatNumber(data.channel2_AF7) }}</td>
                    <td>{{ formatNumber(data.channel3_AF8) }}</td>
                    <td>{{ formatNumber(data.channel4_TP10) }}</td>
                    <td>
                      <span
                        class="badge badge-xs"
                        :class="{
                          'badge-success': data.signalQuality === 1,
                          'badge-warning': data.signalQuality === 2,
                          'badge-error': !data.signalQuality || data.signalQuality >= 4
                        }"
                        >{{
                          data.signalQuality === 1
                            ? 'Good'
                            : data.signalQuality === 2
                              ? 'Med'
                              : data.signalQuality
                                ? 'Poor'
                                : 'N/A'
                        }}</span
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Heart Rate Tab -->
      <div v-else-if="activeTab === 'ppg'" class="flex flex-col gap-4 pb-4">
        <!-- Current BPM Display -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body flex flex-row items-center justify-center gap-6 py-6">
            <div
              v-if="connectedDevice && connectedDevice.heartRate > 0"
              class="flex items-center gap-6"
            >
              <div class="text-6xl">💓</div>
              <div>
                <div class="text-5xl font-bold text-error">{{ connectedDevice.heartRate }}</div>
                <div class="text-lg text-base-content/60">BPM</div>
              </div>
            </div>
            <div v-else-if="connectedDevice" class="flex items-center gap-4">
              <div class="text-6xl">💓</div>
              <div>
                <div class="text-xl text-base-content/60">Calculating...</div>
                <span class="loading loading-dots loading-md mt-1"></span>
              </div>
            </div>
            <div v-else class="flex items-center gap-4">
              <div class="text-6xl opacity-30">💓</div>
              <div class="text-xl text-base-content/40">No Device Connected</div>
            </div>
          </div>
        </div>

        <!-- Heart Rate Graph -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body flex flex-col">
            <div class="flex items-center justify-between">
              <h3 class="card-title">📈 Heart Rate</h3>
              <div class="flex items-center gap-3">
                <span v-if="heartRateHistory.length > 0" class="badge badge-ghost text-xs">
                  {{ heartRateHistory.length }} readings
                </span>
                <button
                  @click="clearHeartRateHistory"
                  class="btn btn-ghost btn-xs"
                  :disabled="heartRateHistory.length === 0"
                >
                  Clear
                </button>
              </div>
            </div>
            <div class="h-80">
              <Line
                v-if="hrChartData.datasets[0].data.length > 0"
                :data="hrChartData"
                :options="hrChartOptions"
                class="h-full"
              />
              <div v-else class="flex h-full items-center justify-center text-base-content/60">
                <div class="text-center">
                  <div class="mb-4 text-6xl">📡</div>
                  <p>No heart rate data yet</p>
                  <p class="text-sm">Readings will appear here as they are received</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
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

interface ConnectedDevice {
  name: string;
  signalQuality: number;
  battery: number;
  heartRate: number;
}

const isTrackerRunning = ref(false);
const connectedDevice = ref<ConnectedDevice | null>(null);
const latestData = ref<MuseData[]>([]);
const totalDataPoints = ref(0);
const activeTab = ref<'connection' | 'eeg' | 'ppg'>('connection');
const isLoading = ref(true);
const discoveredDevices = ref<Array<{ name: string; macAddress: string; rssi: number }>>([]);
const selectedDeviceMac = ref<string>('');
const isConnecting = ref(false);
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let lastDataHash = ''; // track whether EEG data actually changed

// Heart rate history for graph (rolling window of last 120 readings = ~4 min at 2s refresh)
const MAX_HR_POINTS = 120;
const heartRateHistory = ref<{ time: string; bpm: number }[]>([]);
let lastRecordedHR = 0;

// Filter out connected device from discovered devices list
const availableDevices = computed(() => {
  if (!connectedDevice.value) {
    return discoveredDevices.value;
  }
  return discoveredDevices.value.filter((d) => d.name !== connectedDevice.value?.name);
});

// Signal quality descriptive labels (HSI: 1=good, 2=mediocre, 4=poor)
const signalQualityLabel = computed(() => {
  const q = connectedDevice.value?.signalQuality ?? 4;
  if (q <= 1) return 'Good';
  if (q <= 2) return 'Mediocre';
  return 'Poor';
});

const signalQualityColor = computed(() => {
  const q = connectedDevice.value?.signalQuality ?? 4;
  if (q <= 1) return 'text-success';
  if (q <= 2) return 'text-warning';
  return 'text-error';
});

const signalQualityProgressClass = computed(() => {
  const q = connectedDevice.value?.signalQuality ?? 4;
  if (q <= 1) return 'progress-success';
  if (q <= 2) return 'progress-warning';
  return 'progress-error';
});

// Chart data for EEG
const eegChartData = computed(() => {
  const labels = latestData.value.slice(-50).map((d) => formatTimestamp(d.timestamp));
  const data = latestData.value.slice(-50);

  return {
    labels,
    datasets:
      data.length > 0
        ? [
            {
              label: 'TP9 (Left Ear)',
              data: data.map((d) => d.channel1_TP9 ?? 0),
              borderColor: 'rgb(99, 102, 241)',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            },
            {
              label: 'AF7 (Left Forehead)',
              data: data.map((d) => d.channel2_AF7 ?? 0),
              borderColor: 'rgb(236, 72, 153)',
              backgroundColor: 'rgba(236, 72, 153, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            },
            {
              label: 'AF8 (Right Forehead)',
              data: data.map((d) => d.channel3_AF8 ?? 0),
              borderColor: 'rgb(34, 211, 238)',
              backgroundColor: 'rgba(34, 211, 238, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: 0
            },
            {
              label: 'TP10 (Right Ear)',
              data: data.map((d) => d.channel4_TP10 ?? 0),
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

const eegChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: connectedDevice.value ? { duration: 0 } : (false as const),
  scales: {
    x: {
      display: true,
      title: { display: true, text: 'Time' },
      ticks: { maxTicksLimit: 10 }
    },
    y: {
      display: true,
      title: { display: true, text: 'Amplitude (μV)' },
      min: 600,
      max: 800
    }
  },
  plugins: {
    legend: { display: true, position: 'top' as const },
    tooltip: { enabled: true }
  }
}));

// Heart rate chart data
const hrChartData = computed(() => {
  const labels = heartRateHistory.value.map((h) => h.time);
  const data = heartRateHistory.value.map((h) => h.bpm);

  return {
    labels,
    datasets: [
      {
        label: 'Heart Rate (BPM)',
        data,
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        tension: 0.4,
        fill: true,
        pointRadius: 2,
        pointBackgroundColor: 'rgb(239, 68, 68)',
        borderWidth: 2
      }
    ]
  };
});

const hrChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  scales: {
    x: {
      display: true,
      title: { display: true, text: 'Time' },
      ticks: { maxTicksLimit: 10, maxRotation: 0 }
    },
    y: {
      display: true,
      title: { display: true, text: 'BPM' },
      suggestedMin: 40,
      suggestedMax: 120
    }
  },
  plugins: {
    legend: { display: false },
    tooltip: { enabled: true }
  }
};

function clearHeartRateHistory() {
  heartRateHistory.value = [];
  lastRecordedHR = 0;
}

onMounted(async () => {
  await loadData();
  isLoading.value = false;
  // Auto-refresh every 2 seconds
  refreshInterval = setInterval(loadData, 2000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

async function loadData() {
  try {
    const data = await typedIpcRenderer.invoke('muse:get-tracker-status');
    if (data) {
      isTrackerRunning.value = data.isRunning;
      connectedDevice.value = data.connectedDevice || null;
      totalDataPoints.value = data.totalDataPoints || 0;

      // Only update latestData when the data actually changed to avoid
      // unnecessary Chart.js re-renders that cause freezes
      const incoming = data.latestData || [];
      const newHash =
        incoming.length > 0
          ? `${incoming.length}-${incoming[0]?.id}-${incoming[incoming.length - 1]?.id}`
          : '0';
      if (newHash !== lastDataHash) {
        lastDataHash = newHash;
        latestData.value = incoming.map((d: any) => ({
          ...d,
          timestamp: new Date(d.timestamp)
        }));
      }

      // Record heart rate into rolling history for graph
      const hr = data.connectedDevice?.heartRate;
      if (hr && hr > 0 && hr !== lastRecordedHR) {
        lastRecordedHR = hr;
        const now = new Date();
        heartRateHistory.value.push({
          time: now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }),
          bpm: hr
        });
        if (heartRateHistory.value.length > MAX_HR_POINTS) {
          heartRateHistory.value.shift();
        }
      }
    }

    // Load discovered devices if tracking is running and no device connected
    if (data?.isRunning && !data?.connectedDevice) {
      try {
        const devices = await typedIpcRenderer.invoke('muse:get-discovered-devices');
        discoveredDevices.value = devices || [];
      } catch (err) {
        console.warn('Error loading discovered devices:', err);
      }
    }
  } catch (error) {
    console.error('Error loading Muse data:', error);
  }
}

async function startTracking() {
  try {
    await typedIpcRenderer.invoke('muse:start-tracker');
    isTrackerRunning.value = true;
  } catch (error) {
    console.error('Error starting tracker:', error);
  }
}

async function stopTracking() {
  try {
    await typedIpcRenderer.invoke('muse:stop-tracker');
    isTrackerRunning.value = false;
  } catch (error) {
    console.error('Error stopping tracker:', error);
  }
}

async function refreshData() {
  await loadData();
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
