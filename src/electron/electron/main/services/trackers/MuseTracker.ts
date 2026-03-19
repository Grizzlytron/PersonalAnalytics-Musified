import { Tracker } from './Tracker';
import getMainLogger from '../../../config/Logger';
import { MetadataSample, MuseTrackerService, RawEegSample } from './MuseTrackerService';
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
  receivedAtMs?: number;
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
  private collectingInterval: number;
  private aggregationTimer: NodeJS.Timeout | null = null;
  private currentDeviceId: string | null = null;
  private currentDeviceName: string | null = null;
  private isConnected: boolean = false;
  private nativeAvailable: boolean = false;

  // Raw EEG packet buffer (high frequency).
  private eegBuffer: DataPacket[] = [];
  private lastBatteryLevel: number = 0;
  // HSI values per channel (1=good, 2=mediocre, 4=poor).
  private lastHsiValues: number[] = [4, 4, 4, 4];
  private lastSavedMetadata: MetadataSample | null = null;
  private savedSamplesSinceProgressLog: number = 0;
  private lastSaveProgressLogMs: number = 0;
  private readonly SAVE_PROGRESS_LOG_INTERVAL_MS = 30000;

  // PRESET_1035: 4CH EEG 14bit@256Hz + 4CH Optics@64Hz low-power + accel/gyro@52Hz + battery@1Hz
  // Battery-saving preset for raw EEG collection with quality metadata.
  private readonly MUSE_2025_PRESET = 35; // SDK enum index for PRESET_1035
  private presetConfigured: boolean = false; // Track if we've set the preset (to handle disconnect/reconnect)

  constructor(collectingInterval: number = 1000) {
    this.collectingInterval = collectingInterval;
    LOG.info(`${this.name} created with raw EEG only mode, interval=${collectingInterval}ms`);
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
          LOG.info('First connection - applying PRESET_1035...');
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
          LOG.info('Reconnected with PRESET_1035 - EEG and quality listeners active');
          this.enableStreaming();
        }
      } else if (packet.currentState === ConnectionState.DISCONNECTED) {
        this.isConnected = false;
        this.currentDeviceId = null;
        this.currentDeviceName = null;
        this.presetConfigured = false; // Reset flag on disconnect
        this.lastSavedMetadata = null;
        LOG.info(`Disconnected from ${packet.museName}`);
      } else if (packet.currentState === ConnectionState.CONNECTING) {
        LOG.info(`Connecting to ${packet.museName}...`);
      }
    });

    // EEG data
    this.museCore.on('eegData', (packet: DataPacket) => {
      this.eegBuffer.push({ ...packet, receivedAtMs: Date.now() });
    });

    // Keep battery + HSI quality metadata because it is still valuable for raw EEG quality checks.
    this.museCore.on('batteryData', (packet: DataPacket) => {
      const channels = packet.channels as any;
      if (channels && typeof channels.chargePercentage === 'number') {
        this.lastBatteryLevel = channels.chargePercentage;
      } else if (packet.values && packet.values.length > 0) {
        const value = packet.values[0];
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.lastBatteryLevel = value;
        }
      }
    });

    this.museCore.on('hsiData', (packet: DataPacket) => {
      if (packet.values && packet.values.length >= 4) {
        this.lastHsiValues = packet.values.slice(0, 4);
      } else if (packet.channels) {
        const ch = packet.channels as any;
        this.lastHsiValues = [ch.ch0 ?? ch.eeg1 ?? 4, ch.ch1 ?? ch.eeg2 ?? 4, ch.ch2 ?? ch.eeg3 ?? 4, ch.ch3 ?? ch.eeg4 ?? 4];
      }
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
      LOG.info('Data transmission enabled (EEG + quality metadata)');
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

      this.savedSamplesSinceProgressLog = 0;
      this.lastSaveProgressLogMs = Date.now();

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
      this.lastSavedMetadata = null;
      this.savedSamplesSinceProgressLog = 0;
      this.lastSaveProgressLogMs = 0;

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

  /** Persist buffered raw EEG packets in batch to SQLite. */
  private async aggregateAndSave(): Promise<void> {
    if (!this.isConnected || !this.currentDeviceId) {
      return;
    }

    try {
      const rawEegSamples = this.extractRawEegSamples();
      if (rawEegSamples.length > 0) {
        await MuseTrackerService.saveRawEegBatch(rawEegSamples);
        await this.saveMetadataOnChange(rawEegSamples[rawEegSamples.length - 1].timestamp);
        this.savedSamplesSinceProgressLog += rawEegSamples.length;

        const now = Date.now();
        const elapsedMs = now - this.lastSaveProgressLogMs;
        if (elapsedMs >= this.SAVE_PROGRESS_LOG_INTERVAL_MS) {
          LOG.info(
            `Saving active: ${this.savedSamplesSinceProgressLog} raw EEG samples persisted in the last ${Math.round(elapsedMs / 1000)}s`
          );
          this.savedSamplesSinceProgressLog = 0;
          this.lastSaveProgressLogMs = now;
        }
      }
      this.clearAllBuffers();
    } catch (error) {
      LOG.error('Error aggregating and saving Muse data', error);
    }
  }

  private async saveMetadataOnChange(timestamp: Date): Promise<void> {
    const metadata = this.buildMetadataSample(timestamp);
    if (!metadata) {
      return;
    }
    if (!this.hasMetadataChanged(metadata, this.lastSavedMetadata)) {
      return;
    }

    await MuseTrackerService.saveMetadataSample(metadata);
    this.lastSavedMetadata = metadata;
  }

  private buildMetadataSample(timestamp: Date): MetadataSample | null {
    const [hsiTp9, hsiAf7, hsiAf8, hsiTp10] = this.lastHsiValues;
    const hsiValues = [hsiTp9, hsiAf7, hsiAf8, hsiTp10].filter(
      (value) => typeof value === 'number' && Number.isFinite(value)
    ) as number[];

    const signalQuality =
      hsiValues.length > 0 ? hsiValues.reduce((worst, value) => Math.max(worst, value), 0) : undefined;

    const metadata: MetadataSample = {
      timestamp,
      batteryLevel: this.lastBatteryLevel,
      hsiTp9,
      hsiAf7,
      hsiAf8,
      hsiTp10,
      signalQuality
    };

    const hasAnyValue =
      Number.isFinite(metadata.batteryLevel as number) ||
      Number.isFinite(metadata.hsiTp9 as number) ||
      Number.isFinite(metadata.hsiAf7 as number) ||
      Number.isFinite(metadata.hsiAf8 as number) ||
      Number.isFinite(metadata.hsiTp10 as number) ||
      Number.isFinite(metadata.signalQuality as number);

    return hasAnyValue ? metadata : null;
  }

  private hasMetadataChanged(current: MetadataSample, previous: MetadataSample | null): boolean {
    if (!previous) {
      return true;
    }

    const sameInt = (a?: number, b?: number) => (a ?? null) === (b ?? null);
    return !(
      sameInt(current.batteryLevel, previous.batteryLevel) &&
      sameInt(current.hsiTp9, previous.hsiTp9) &&
      sameInt(current.hsiAf7, previous.hsiAf7) &&
      sameInt(current.hsiAf8, previous.hsiAf8) &&
      sameInt(current.hsiTp10, previous.hsiTp10) &&
      sameInt(current.signalQuality, previous.signalQuality)
    );
  }

  private extractRawEegSamples(): RawEegSample[] {
    if (!this.isConnected) {
      return [];
    }

    const samples: RawEegSample[] = [];

    for (const packet of this.eegBuffer) {
      if (!packet.channels) {
        continue;
      }

      const channels = packet.channels as any;
      const tp9 = channels.tp9;
      const af7 = channels.af7;
      const af8 = channels.af8;
      const tp10 = channels.tp10;

      if (![tp9, af7, af8, tp10].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        continue;
      }

      const receivedAtMs =
        typeof packet.receivedAtMs === 'number' && Number.isFinite(packet.receivedAtMs)
          ? packet.receivedAtMs
          : Date.now();

      samples.push({
        timestamp: new Date(receivedAtMs),
        tp9,
        af7,
        af8,
        tp10
      });
    }

    return samples;
  }

  private clearAllBuffers(): void {
    this.eegBuffer = [];
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
