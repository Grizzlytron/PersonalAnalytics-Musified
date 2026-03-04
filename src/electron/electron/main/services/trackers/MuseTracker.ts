import { Tracker } from './Tracker';
import getMainLogger from '../../../config/Logger';
import { MuseTrackerService, MuseData } from './MuseTrackerService';
import { createRequire } from 'module';

const LOG = getMainLogger('MuseTracker');

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// Import types from muse-tracker package
interface MuseDevice {
  name: string;
  macAddress: string;
  rssi: number;
}

interface DataPacket {
  timestamp: number;
  packetType: number;
  values?: number[];
  channels?: Record<string, number>;
}

interface ConnectionPacket {
  currentState: number;
  previousState: number;
  museName: string;
  macAddress: string;
}

// Connection state constants
const ConnectionState = {
  UNKNOWN: 0,
  CONNECTED: 1,
  CONNECTING: 2,
  DISCONNECTED: 3,
  NEEDS_UPDATE: 4,
  NEEDS_LICENSE: 5
};

// Load native module
let MuseTrackerCore: any;
let museTrackerCoreInstance: any = null;

function loadNativeModule(): boolean {
  try {
    const museTracker = require('muse-tracker');
    MuseTrackerCore = museTracker.MuseTrackerCore;
    return true;
  } catch (error) {
    LOG.error('Failed to load muse-tracker native module', error);
    return false;
  }
}

function getMuseTrackerCore(): any {
  if (!museTrackerCoreInstance) {
    if (!loadNativeModule()) {
      throw new Error('Native Muse module not available');
    }
    museTrackerCoreInstance = new MuseTrackerCore();
  }
  return museTrackerCoreInstance;
}

export class MuseTracker implements Tracker {
  public readonly name: string = 'MuseTracker';
  public isRunning: boolean = false;

  private museCore: any = null;
  private trackerService: MuseTrackerService;
  private collectingInterval: number;
  private aggregationTimer: NodeJS.Timeout | null = null;
  private currentDeviceId: string | null = null;
  private currentDeviceName: string | null = null;
  private isConnected: boolean = false;
  private nativeAvailable: boolean = false;

  // Data aggregation buffers - Raw sensors
  private eegBuffer: DataPacket[] = [];
  private ppgBuffer: DataPacket[] = [];
  private batteryBuffer: DataPacket[] = [];
  private accelerometerBuffer: DataPacket[] = [];
  private gyroBuffer: DataPacket[] = [];
  private drlRefBuffer: DataPacket[] = [];
  
  // Band power buffers - Relative
  private alphaRelativeBuffer: DataPacket[] = [];
  private betaRelativeBuffer: DataPacket[] = [];
  private deltaRelativeBuffer: DataPacket[] = [];
  private thetaRelativeBuffer: DataPacket[] = [];
  private gammaRelativeBuffer: DataPacket[] = [];
  
  // Band power buffers - Absolute
  private alphaAbsoluteBuffer: DataPacket[] = [];
  private betaAbsoluteBuffer: DataPacket[] = [];
  private deltaAbsoluteBuffer: DataPacket[] = [];
  private thetaAbsoluteBuffer: DataPacket[] = [];
  private gammaAbsoluteBuffer: DataPacket[] = [];
  
  // Band power buffers - Scores
  private alphaScoreBuffer: DataPacket[] = [];
  private betaScoreBuffer: DataPacket[] = [];
  private deltaScoreBuffer: DataPacket[] = [];
  private thetaScoreBuffer: DataPacket[] = [];
  private gammaScoreBuffer: DataPacket[] = [];
  
  // Quality indicator buffers
  private isGoodBuffer: DataPacket[] = [];
  
  // Derived EEG buffers
  private varianceEegBuffer: DataPacket[] = [];
  
  private lastBatteryLevel: number = 0;

  // HSI_PRECISION-based signal quality (1=good, 2=mediocre, 4=poor per channel)
  // We store the latest per-channel values and derive a 1-4 UI score
  private lastHsiValues: number[] = [4, 4, 4, 4]; // Default: poor fit (no head)

  // Heart rate calculation from raw Optics/PPG stream
  private ppgRawSamples: number[] = []; // Ring buffer of raw optics values at ~64 Hz
  private readonly PPG_SAMPLE_RATE = 64; // Muse S Optics sampling rate in Hz
  private readonly PPG_BUFFER_SECONDS = 10; // Keep 10 seconds of data
  private readonly PPG_BUFFER_SIZE = 64 * 10; // 640 samples
  private currentHeartRate: number = 0;

  // PRESET_1035: 4CH EEG 14bit@256Hz + 4CH Optics@64Hz low-power + accel/gyro@52Hz + battery@1Hz
  // This is the optimal battery-saving preset that includes optics for heart rate
  private readonly MUSE_2025_PRESET = 35; // SDK enum index for PRESET_1035
  private presetConfigured: boolean = false; // Track if we've set the preset (to handle disconnect/reconnect)

  constructor(collectingInterval: number = 5000) {
    this.collectingInterval = collectingInterval;
    this.trackerService = new MuseTrackerService();
    LOG.info(`${this.name} created, native module will be loaded on start()`);
  }

  /** Load native module lazily — only when actually starting the tracker */
  private ensureNativeLoaded(): boolean {
    if (this.nativeAvailable) return true;
    try {
      this.museCore = getMuseTrackerCore();
      this.setupEventHandlers();
      this.nativeAvailable = true;
      LOG.info(`${this.name} native module loaded successfully`);
      return true;
    } catch (error) {
      LOG.warn(`${this.name} native module not available (stub mode)`, error);
      this.nativeAvailable = false;
      return false;
    }
  }

  private setupEventHandlers(): void {
    if (!this.museCore) return;

    // Device discovery
    this.museCore.on('deviceDiscovered', (device: MuseDevice) => {
      LOG.info(
        `Discovered Muse device: ${device.name} (${device.macAddress}), Signal Strength (RSSI): ${device.rssi} dBm`
      );
    });

    // Connection state changes
    this.museCore.on('connectionStateChanged', (packet: ConnectionPacket) => {
      const stateName = this.getConnectionStateName(packet.currentState);
      LOG.info(`Connection state changed to: ${stateName} for ${packet.museName}`);

      if (packet.currentState === ConnectionState.CONNECTED) {
        this.isConnected = true;
        this.currentDeviceId = packet.macAddress;
        this.currentDeviceName = packet.museName;
        LOG.info(`Successfully connected to ${packet.museName}`);

        // Check if we need to configure the preset
        if (!this.presetConfigured) {
          // First connection - set the preset (this will cause disconnect/reconnect)
          LOG.info('First connection - setting PRESET_1035 to enable all sensors...');
          try {
            this.museCore.setPreset(this.MUSE_2025_PRESET);
            this.presetConfigured = true;
            LOG.info('Preset set - device will disconnect and reconnect with PRESET_1035');
          } catch (err) {
            LOG.error('Failed to set preset', err);
            // If preset fails, enable streaming anyway with default preset
            this.presetConfigured = true;
            this.enableStreaming();
          }
        } else {
          // Second connection (after preset applied) - now enable data transmission
          LOG.info('Reconnected with PRESET_1035 - all data listeners active');
          this.enableStreaming();
        }
      } else if (packet.currentState === ConnectionState.DISCONNECTED) {
        this.isConnected = false;
        this.currentDeviceId = null;
        this.currentDeviceName = null;
        this.presetConfigured = false; // Reset flag on disconnect
        LOG.info(`Disconnected from ${packet.museName}`);
      } else if (packet.currentState === ConnectionState.CONNECTING) {
        LOG.info(`Connecting to ${packet.museName}...`);
      }
    });

    // EEG data
    this.museCore.on('eegData', (packet: DataPacket) => {
      this.eegBuffer.push(packet);
    });

    // PPG data (legacy — older Muse models)
    this.museCore.on('ppgData', (packet: DataPacket) => {
      this.ppgBuffer.push(packet);
    });

    // Optics data (Muse S 2025 — used for heart rate calculation)
    this.museCore.on('opticsData', (packet: DataPacket) => {
      this.ppgBuffer.push(packet); // Reuse ppgBuffer for optics
      // Feed raw samples into the heart rate calculator
      if (packet.values && packet.values.length > 0) {
        // Use the first channel value from each optics packet for peak detection
        this.ppgRawSamples.push(packet.values[0]);
        // Trim to ring buffer size
        if (this.ppgRawSamples.length > this.PPG_BUFFER_SIZE) {
          this.ppgRawSamples = this.ppgRawSamples.slice(-this.PPG_BUFFER_SIZE);
        }
        // Recalculate heart rate when we have enough data (at least 3 seconds)
        if (this.ppgRawSamples.length >= this.PPG_SAMPLE_RATE * 3) {
          this.currentHeartRate = this.calculateHeartRate();
        }
      }
    });

    // Battery data
    this.museCore.on('batteryData', (packet: DataPacket) => {
      const channels = packet.channels as any;
      if (channels && typeof channels.chargePercentage === 'number') {
        this.lastBatteryLevel = channels.chargePercentage;
        LOG.info(`Battery level updated: ${this.lastBatteryLevel}%`);
      } else if (packet.values && packet.values.length > 0) {
        // Fallback: battery percentage might be in values array
        this.lastBatteryLevel = packet.values[0];
        LOG.info(`Battery level from values: ${this.lastBatteryLevel}%`);
      }
      this.batteryBuffer.push(packet);
    });

    // HSI_PRECISION data — headband fit quality per channel
    // Values: 1 = good fit, 2 = mediocre fit, 4 = poor fit
    this.museCore.on('hsiData', (packet: DataPacket) => {
      if (packet.values && packet.values.length >= 4) {
        this.lastHsiValues = packet.values.slice(0, 4);
      } else if (packet.channels) {
        const ch = packet.channels as any;
        this.lastHsiValues = [
          ch.ch0 ?? ch.eeg1 ?? 4,
          ch.ch1 ?? ch.eeg2 ?? 4,
          ch.ch2 ?? ch.eeg3 ?? 4,
          ch.ch3 ?? ch.eeg4 ?? 4
        ];
      }
    });

    // Movement sensors
    this.museCore.on('accelerometerData', (packet: DataPacket) => {
      this.accelerometerBuffer.push(packet);
    });

    this.museCore.on('gyroData', (packet: DataPacket) => {
      this.gyroBuffer.push(packet);
    });

    this.museCore.on('drlRefData', (packet: DataPacket) => {
      this.drlRefBuffer.push(packet);
    });

    // Band power data - Relative (best for ML)
    this.museCore.on('alphaRelativeData', (packet: DataPacket) => {
      this.alphaRelativeBuffer.push(packet);
    });

    this.museCore.on('betaRelativeData', (packet: DataPacket) => {
      this.betaRelativeBuffer.push(packet);
    });

    this.museCore.on('deltaRelativeData', (packet: DataPacket) => {
      this.deltaRelativeBuffer.push(packet);
    });

    this.museCore.on('thetaRelativeData', (packet: DataPacket) => {
      this.thetaRelativeBuffer.push(packet);
    });

    this.museCore.on('gammaRelativeData', (packet: DataPacket) => {
      this.gammaRelativeBuffer.push(packet);
    });

    // Band power data - Absolute
    this.museCore.on('alphaAbsoluteData', (packet: DataPacket) => {
      this.alphaAbsoluteBuffer.push(packet);
    });

    this.museCore.on('betaAbsoluteData', (packet: DataPacket) => {
      this.betaAbsoluteBuffer.push(packet);
    });

    this.museCore.on('deltaAbsoluteData', (packet: DataPacket) => {
      this.deltaAbsoluteBuffer.push(packet);
    });

    this.museCore.on('thetaAbsoluteData', (packet: DataPacket) => {
      this.thetaAbsoluteBuffer.push(packet);
    });

    this.museCore.on('gammaAbsoluteData', (packet: DataPacket) => {
      this.gammaAbsoluteBuffer.push(packet);
    });

    // Band power data - Scores
    this.museCore.on('alphaScoreData', (packet: DataPacket) => {
      this.alphaScoreBuffer.push(packet);
    });

    this.museCore.on('betaScoreData', (packet: DataPacket) => {
      this.betaScoreBuffer.push(packet);
    });

    this.museCore.on('deltaScoreData', (packet: DataPacket) => {
      this.deltaScoreBuffer.push(packet);
    });

    this.museCore.on('thetaScoreData', (packet: DataPacket) => {
      this.thetaScoreBuffer.push(packet);
    });

    this.museCore.on('gammaScoreData', (packet: DataPacket) => {
      this.gammaScoreBuffer.push(packet);
    });

    // Quality indicators
    this.museCore.on('isGoodData', (packet: DataPacket) => {
      this.isGoodBuffer.push(packet);
    });

    // Derived EEG values
    this.museCore.on('varianceEegData', (packet: DataPacket) => {
      this.varianceEegBuffer.push(packet);
    });

    // Errors
    this.museCore.on('error', (error: Error) => {
      LOG.error('Muse device error', error);
    });
  }

  private getConnectionStateName(state: number): string {
    switch (state) {
      case ConnectionState.UNKNOWN:
        return 'UNKNOWN';
      case ConnectionState.CONNECTED:
        return 'CONNECTED';
      case ConnectionState.CONNECTING:
        return 'CONNECTING';
      case ConnectionState.DISCONNECTED:
        return 'DISCONNECTED';
      case ConnectionState.NEEDS_UPDATE:
        return 'NEEDS_UPDATE';
      case ConnectionState.NEEDS_LICENSE:
        return 'NEEDS_LICENSE';
      default:
        return `UNKNOWN(${state})`;
    }
  }

  /**
   * Enable data streaming after connection and preset configuration
   */
  private enableStreaming(): void {
    try {
      this.museCore.startStreaming();
      LOG.info('Data transmission enabled - all sensors active (EEG, PPG, accelerometer, gyro, battery, band powers)');
    } catch (err) {
      LOG.error('Failed to enable data transmission', err);
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      LOG.warn(`${this.name} is already running`);
      return;
    }

    try {
      LOG.info(`Starting ${this.name}...`);

      // Load native module on first start (deferred from constructor)
      this.ensureNativeLoaded();

      if (this.nativeAvailable && this.museCore) {
        // Start device discovery
        LOG.info('Starting Bluetooth device discovery...');
        this.museCore.start();
        LOG.info('Device discovery started');
      } else {
        LOG.warn('Native module not available, running in stub mode');
      }

      // Start aggregation timer
      this.aggregationTimer = setInterval(() => {
        this.aggregateAndSave();
      }, this.collectingInterval);

      this.isRunning = true;
      LOG.info(`${this.name} started successfully`);
    } catch (error) {
      LOG.error(`Failed to start ${this.name}`, error);
      throw error;
    }
  }

  public async resume(): Promise<void> {
    if (this.isRunning) {
      LOG.debug(`${this.name} is already running`);
      return;
    }
    await this.start();
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      LOG.warn(`${this.name} is not running`);
      return;
    }

    try {
      LOG.info(`Stopping ${this.name}...`);

      // Stop aggregation timer
      if (this.aggregationTimer) {
        clearInterval(this.aggregationTimer);
        this.aggregationTimer = null;
      }

      // Final aggregation
      await this.aggregateAndSave();

      // Stop the core tracker
      if (this.nativeAvailable && this.museCore) {
        this.museCore.stop();
      }

      // Reset preset flag for next connection
      this.presetConfigured = false;

      this.isRunning = false;
      LOG.info(`${this.name} stopped successfully`);
    } catch (error) {
      LOG.error(`Failed to stop ${this.name}`, error);
    }
  }

  /**
   * Connect to a specific Muse device by MAC address
   */
  public async connectToDevice(macAddress: string): Promise<void> {
    if (!this.nativeAvailable || !this.museCore) {
      throw new Error('Native module not available');
    }

    try {
      LOG.info(`Attempting to connect to device: ${macAddress}`);

      // Check if device was discovered
      const devices = this.museCore.getDiscoveredDevices();
      LOG.debug(`Available devices for connection: ${JSON.stringify(devices)}`);

      const deviceFound = devices.find((d: MuseDevice) => d.macAddress === macAddress);
      if (!deviceFound) {
        LOG.warn(`Device ${macAddress} not found in discovered devices`);
      }

      await this.museCore.connect(macAddress);
      LOG.info(`Connect request sent to device: ${macAddress}`);
    } catch (error) {
      LOG.error(`Failed to connect to device ${macAddress}`, error);
      throw error;
    }
  }

  /**
   * Disconnect from current device
   */
  public async disconnectDevice(): Promise<void> {
    if (!this.nativeAvailable || !this.museCore) {
      return;
    }

    try {
      LOG.info('Disconnecting from device...');
      this.museCore.disconnect();
      this.isConnected = false;
      this.currentDeviceId = null;
      this.currentDeviceName = null;
      this.presetConfigured = false; // Reset for next connection
    } catch (error) {
      LOG.error('Failed to disconnect device', error);
    }
  }

  /**
   * Get list of discovered devices
   */
  public getDiscoveredDevices(): MuseDevice[] {
    if (!this.nativeAvailable || !this.museCore) {
      LOG.warn('Native module not available, no devices can be discovered');
      return [];
    }
    try {
      const devices = this.museCore.getDiscoveredDevices();
      LOG.debug(`Retrieved ${devices.length} discovered devices`);
      if (devices.length > 0) {
        devices.forEach((d: MuseDevice) => {
          LOG.debug(`  - Device: ${d.name} (${d.macAddress}), RSSI: ${d.rssi}`);
        });
      }
      return devices;
    } catch (error) {
      LOG.error('Error retrieving discovered devices', error);
      return [];
    }
  }

  /**
   * Get currently connected device info
   */
  public getConnectedDevice(): MuseDevice | null {
    if (!this.nativeAvailable || !this.museCore) {
      return null;
    }
    return this.museCore.getConnectedDevice();
  }

  /**
   * Check if connected to a device
   */
  public isDeviceConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get current battery level
   */
  public getBatteryLevel(): number {
    return this.lastBatteryLevel;
  }

  /**
   * Get current heart rate calculated from raw PPG data
   */
  public getHeartRate(): number {
    return this.currentHeartRate;
  }

  /**
   * Calculate heart rate from raw PPG samples using peak detection.
   * Uses a bandpass-style approach: smooths the signal, detects peaks,
   * and computes BPM from average inter-peak interval.
   */
  private calculateHeartRate(): number {
    const samples = this.ppgRawSamples;
    const n = samples.length;
    if (n < this.PPG_SAMPLE_RATE * 3) return 0;

    // 1. Smooth with a simple moving average (window ~0.05s = 3 samples at 64 Hz)
    const smoothWindow = 3;
    const smoothed: number[] = [];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - smoothWindow); j <= Math.min(n - 1, i + smoothWindow); j++) {
        sum += samples[j];
        count++;
      }
      smoothed.push(sum / count);
    }

    // 2. Compute mean and standard deviation for adaptive threshold
    const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
    const variance = smoothed.reduce((a, b) => a + (b - mean) ** 2, 0) / smoothed.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev * 0.5;

    // 3. Find peaks: local maxima above threshold, with minimum distance (~0.3s = 19 samples)
    const minPeakDistance = Math.floor(this.PPG_SAMPLE_RATE * 0.3); // ~300ms between beats minimum
    const peaks: number[] = [];
    for (let i = 2; i < smoothed.length - 2; i++) {
      if (
        smoothed[i] > threshold &&
        smoothed[i] > smoothed[i - 1] &&
        smoothed[i] > smoothed[i + 1] &&
        smoothed[i] > smoothed[i - 2] &&
        smoothed[i] > smoothed[i + 2]
      ) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minPeakDistance) {
          peaks.push(i);
        }
      }
    }

    if (peaks.length < 2) return 0;

    // 4. Calculate inter-peak intervals and average
    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i - 1]);
    }

    // Remove outlier intervals (> 2x or < 0.5x median)
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    const filtered = intervals.filter((iv) => iv >= median * 0.5 && iv <= median * 2.0);
    if (filtered.length === 0) return 0;

    const avgInterval = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    const bpm = Math.round((this.PPG_SAMPLE_RATE / avgInterval) * 60);

    // Sanity check: normal resting heart rate range
    if (bpm >= 40 && bpm <= 200) {
      return bpm;
    }
    return 0;
  }

  /**
   * Check if native module is available
   */
  public isNativeAvailable(): boolean {
    return this.nativeAvailable;
  }

  /**
   * Get real-time EEG data for visualization
   */
  public getRealtimeEEG(): DataPacket[] {
    return [...this.eegBuffer];
  }

  /**
   * Get real-time PPG data for visualization
   */
  public getRealtimePPG(): DataPacket[] {
    return [...this.ppgBuffer];
  }

  /**
   * Run diagnostic checks on native module and device discovery
   */
  public runDiagnostics(): void {
    LOG.info('========== MuseTracker Diagnostics ==========');
    LOG.info('Native module available:', this.nativeAvailable);
    LOG.info('Tracker running:', this.isRunning);
    LOG.info('Device connected:', this.isConnected);
    LOG.info('Current device:', this.currentDeviceName || 'None');

    if (this.nativeAvailable && this.museCore) {
      try {
        LOG.info('\n--- Running MuseTrackerCore diagnostics ---');
        this.museCore.diagnose();
        LOG.info('✓ Core diagnostics completed');
      } catch (err) {
        LOG.error('✗ Core diagnostics failed:', err);
      }
    }

    LOG.info('===========================================\n');
  }

  /**
   * Aggregate buffered data and save to database
   */
  private async aggregateAndSave(): Promise<void> {
    if (!this.isConnected || !this.currentDeviceId) {
      return;
    }

    try {
      const now = new Date();

      const isFiniteNumber = (value: unknown): value is number =>
        typeof value === 'number' && Number.isFinite(value);

      // Helper function to average DataPacket values
      const averagePackets = (buffer: DataPacket[]): number => {
        if (buffer.length === 0) return 0;
        let sum = 0;
        let count = 0;
        for (const packet of buffer) {
          if (packet.values && packet.values.length > 0) {
            const finiteValues = packet.values.filter((value) => isFiniteNumber(value));
            if (finiteValues.length === 0) {
              continue;
            }
            // Average all channels together
            sum += finiteValues.reduce((a, b) => a + b, 0) / finiteValues.length;
            count++;
          }
        }
        return count > 0 ? sum / count : 0;
      };

      // Helper function to calculate magnitude from 3-axis data
      const average3AxisMagnitude = (buffer: DataPacket[]): number => {
        if (buffer.length === 0) return 0;
        let sum = 0;
        let count = 0;
        for (const packet of buffer) {
          if (packet.values && packet.values.length >= 3) {
            const [x, y, z] = packet.values;
            if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
              continue;
            }
            sum += Math.sqrt(x * x + y * y + z * z);
            count++;
          }
        }
        return count > 0 ? sum / count : 0;
      };

      // Calculate average EEG values
      let avgTP9 = 0,
        avgAF7 = 0,
        avgAF8 = 0,
        avgTP10 = 0;
      if (this.eegBuffer.length > 0) {
        let eegCount = 0;
        for (const packet of this.eegBuffer) {
          if (packet.channels && 'tp9' in packet.channels) {
            const channels = packet.channels as any;
            const tp9 = isFiniteNumber(channels.tp9) ? channels.tp9 : 0;
            const af7 = isFiniteNumber(channels.af7) ? channels.af7 : 0;
            const af8 = isFiniteNumber(channels.af8) ? channels.af8 : 0;
            const tp10 = isFiniteNumber(channels.tp10) ? channels.tp10 : 0;
            avgTP9 += tp9;
            avgAF7 += af7;
            avgAF8 += af8;
            avgTP10 += tp10;
            eegCount++;
          }
        }
        if (eegCount > 0) {
          avgTP9 /= eegCount;
          avgAF7 /= eegCount;
          avgAF8 /= eegCount;
          avgTP10 /= eegCount;
        }
      }

      // Calculate PPG value from buffered optics/ppg packets
      let ppgValue = 0;
      if (this.ppgBuffer.length > 0) {
        let ppgSum = 0;
        let ppgCount = 0;
        for (const packet of this.ppgBuffer) {
          if (packet.values && packet.values.length > 0) {
            const value = packet.values[0];
            if (isFiniteNumber(value)) {
              ppgSum += value;
              ppgCount++;
            }
          }
        }
        if (ppgCount > 0) {
          ppgValue = ppgSum / ppgCount;
        }
      }

      // Movement sensors - average magnitude
      const accelerometerAvg = average3AxisMagnitude(this.accelerometerBuffer);
      const gyroAvg = average3AxisMagnitude(this.gyroBuffer);

      // Band powers - Relative (0-1, normalized)
      const alphaRelative = averagePackets(this.alphaRelativeBuffer);
      const betaRelative = averagePackets(this.betaRelativeBuffer);
      const deltaRelative = averagePackets(this.deltaRelativeBuffer);
      const thetaRelative = averagePackets(this.thetaRelativeBuffer);
      const gammaRelative = averagePackets(this.gammaRelativeBuffer);

      // Band powers - Absolute (in Bels)
      const alphaAbsolute = averagePackets(this.alphaAbsoluteBuffer);
      const betaAbsolute = averagePackets(this.betaAbsoluteBuffer);
      const deltaAbsolute = averagePackets(this.deltaAbsoluteBuffer);
      const thetaAbsolute = averagePackets(this.thetaAbsoluteBuffer);
      const gammaAbsolute = averagePackets(this.gammaAbsoluteBuffer);

      // Band powers - Scores (0-1, percentile-based)
      const alphaScore = averagePackets(this.alphaScoreBuffer);
      const betaScore = averagePackets(this.betaScoreBuffer);
      const deltaScore = averagePackets(this.deltaScoreBuffer);
      const thetaScore = averagePackets(this.thetaScoreBuffer);
      const gammaScore = averagePackets(this.gammaScoreBuffer);

      // Quality indicators
      const isGood = averagePackets(this.isGoodBuffer);
      const varianceEeg = averagePackets(this.varianceEegBuffer);

      // Signal quality from HSI_PRECISION (SDK: 1=good, 2=mediocre, 4=poor)
      // Store an instant value (latest sample), using worst channel as overall quality.
      const hsiValues = this.lastHsiValues.filter((value) => isFiniteNumber(value));
      const signalQuality = hsiValues.length > 0 ? Math.max(...hsiValues) : 4;

      const finiteOrZero = (value: number): number => (isFiniteNumber(value) ? value : 0);

      // Create comprehensive data object for ML
      const museData: MuseData = {
        deviceId: this.currentDeviceId,
        deviceName: this.currentDeviceName || 'Unknown',
        timestamp: now,
        // EEG channels
        channel1_TP9: finiteOrZero(avgTP9),
        channel2_AF7: finiteOrZero(avgAF7),
        channel3_AF8: finiteOrZero(avgAF8),
        channel4_TP10: finiteOrZero(avgTP10),
        // Heart rate
        ppg: finiteOrZero(ppgValue),
        heartRate: finiteOrZero(this.currentHeartRate),
        // Device status
        batteryLevel: finiteOrZero(this.lastBatteryLevel),
        signalQuality: finiteOrZero(signalQuality),
        connectionState: 'connected',
        // Band powers - Relative
        alphaRelative: finiteOrZero(alphaRelative),
        betaRelative: finiteOrZero(betaRelative),
        deltaRelative: finiteOrZero(deltaRelative),
        thetaRelative: finiteOrZero(thetaRelative),
        gammaRelative: finiteOrZero(gammaRelative),
        // Band powers - Absolute
        alphaAbsolute: finiteOrZero(alphaAbsolute),
        betaAbsolute: finiteOrZero(betaAbsolute),
        deltaAbsolute: finiteOrZero(deltaAbsolute),
        thetaAbsolute: finiteOrZero(thetaAbsolute),
        gammaAbsolute: finiteOrZero(gammaAbsolute),
        // Band powers - Scores
        alphaScore: finiteOrZero(alphaScore),
        betaScore: finiteOrZero(betaScore),
        deltaScore: finiteOrZero(deltaScore),
        thetaScore: finiteOrZero(thetaScore),
        gammaScore: finiteOrZero(gammaScore),
        // Quality indicators
        isGood: finiteOrZero(isGood),
        varianceEeg: finiteOrZero(varianceEeg),
        // Movement
        accelerometerAvg: finiteOrZero(accelerometerAvg),
        gyroAvg: finiteOrZero(gyroAvg),
        // Metadata
        additionalData: JSON.stringify({
          eegSamples: this.eegBuffer.length,
          ppgSamples: this.ppgBuffer.length,
          bandPowerSamples: this.betaRelativeBuffer.length,
          accelerometerSamples: this.accelerometerBuffer.length,
          gyroSamples: this.gyroBuffer.length
        })
      };

      // Save to database
      await this.trackerService.saveMuseData(museData);

      LOG.info(
        `Saved aggregated Muse data: ` +
        `EEG=${this.eegBuffer.length}, PPG=${this.ppgBuffer.length}, ` +
        `BandPowers=${this.betaRelativeBuffer.length}, ` +
        `Accel=${this.accelerometerBuffer.length}, Gyro=${this.gyroBuffer.length}, ` +
        `IsGood=${this.isGoodBuffer.length}`
      );

      // Clear all buffers
      this.eegBuffer = [];
      this.ppgBuffer = [];
      this.batteryBuffer = [];
      this.accelerometerBuffer = [];
      this.gyroBuffer = [];
      this.drlRefBuffer = [];
      this.alphaRelativeBuffer = [];
      this.betaRelativeBuffer = [];
      this.deltaRelativeBuffer = [];
      this.thetaRelativeBuffer = [];
      this.gammaRelativeBuffer = [];
      this.alphaAbsoluteBuffer = [];
      this.betaAbsoluteBuffer = [];
      this.deltaAbsoluteBuffer = [];
      this.thetaAbsoluteBuffer = [];
      this.gammaAbsoluteBuffer = [];
      this.alphaScoreBuffer = [];
      this.betaScoreBuffer = [];
      this.deltaScoreBuffer = [];
      this.thetaScoreBuffer = [];
      this.gammaScoreBuffer = [];
      this.isGoodBuffer = [];
      this.varianceEegBuffer = [];
    } catch (error) {
      LOG.error('Error aggregating and saving Muse data', error);
    }
  }

  /**
   * Diagnostic method to check native module status
   */
  public async diagnoseConnection(): Promise<void> {
    LOG.info('=== Muse Connection Diagnostics ===');
    LOG.info(`Native module available: ${this.nativeAvailable}`);
    LOG.info(`Tracker running: ${this.isRunning}`);
    LOG.info(`Connected: ${this.isConnected}`);

    if (!this.nativeAvailable || !this.museCore) {
      LOG.error('❌ Native module is NOT available!');
      LOG.info('  - Check if muse-tracker package is installed');
      LOG.info('  - Check if native addon was built correctly');
      return;
    }

    try {
      const devices = this.getDiscoveredDevices();
      LOG.info(`Discovered devices: ${devices.length}`);
      devices.forEach((d, i) => {
        LOG.info(`  ${i + 1}. ${d.name} (${d.macAddress})`);
        LOG.info(`     - RSSI: ${d.rssi}`);
      });

      if (devices.length === 0) {
        LOG.warn('❌ No devices found');
        LOG.info('  - Is startListening() being called?');
        LOG.info('  - Is the Muse device in pairing mode?');
        LOG.info('  - Is the Muse device powered on?');
        LOG.info('  - Is Bluetooth enabled on this computer?');
      }
    } catch (err) {
      LOG.error('Error during diagnostic:', err);
    }

    LOG.info('=== End Diagnostics ===');
  }
}
