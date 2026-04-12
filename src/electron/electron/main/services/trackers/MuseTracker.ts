import { Tracker } from './Tracker';
import getMainLogger from '../../../config/Logger';
import {
  MetadataSample,
  MuseTrackerService,
  RawEegSample,
  RawOpticsSample
} from './MuseTrackerService';
import { UsageDataService } from '../UsageDataService';
import { UsageDataEventType } from '../../../enums/UsageDataEventType.enum';
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
  private aggregateAndSaveInFlight: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private presetReconnectTimer: NodeJS.Timeout | null = null;
  private currentDeviceId: string | null = null;
  private currentDeviceName: string | null = null;
  private targetDeviceId: string | null = null;
  private isConnected: boolean = false;
  private nativeAvailable: boolean = false;
  private reconnectAttempts: number = 0;
  private disconnectStartedAtMs: number | null = null;
  private manualDisconnectRequested: boolean = false;
  private stopRequested: boolean = false;

  // Raw EEG packet buffer (high frequency).
  private eegBuffer: DataPacket[] = [];
  // Raw optics packet buffer (4ch at 64Hz on PRESET_1035).
  private opticsBuffer: DataPacket[] = [];
  private lastBatteryLevel: number = 0;
  private lastBatteryUpdatedAtMs: number | null = null;
  // HSI values per channel (1=good, 2=mediocre, 4=poor).
  private lastHsiValues: Array<number | undefined> = [undefined, undefined, undefined, undefined];
  private lastHsiUpdatedAtMs: number | null = null;
  private lastSavedMetadata: MetadataSample | null = null;
  private savedSamplesSinceProgressLog: number = 0;
  private lastSaveProgressLogMs: number = 0;
  private readonly SAVE_PROGRESS_LOG_INTERVAL_MS = 30000;

  // PRESET_1035: 4CH EEG 14bit@256Hz + 4CH Optics@64Hz low-power + accel/gyro@52Hz + battery@1Hz
  // Battery-saving preset for raw EEG collection with quality metadata.
  private readonly MUSE_2025_PRESET = 35; // SDK enum index for PRESET_1035
  private presetConfigured: boolean = false; // Track if we've set the preset (to handle disconnect/reconnect)
  private expectingPresetReconnect: boolean = false;
  private readonly RECONNECT_BASE_DELAY_MS = 1500;
  private readonly RECONNECT_MAX_DELAY_MS = 30000;

  constructor(collectingInterval: number = 1000) {
    this.collectingInterval = collectingInterval;
    LOG.info(`${this.name} created with PRESET-1035 active, saving interval=${collectingInterval}ms`);
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
        this.targetDeviceId = packet.macAddress;
        this.clearReconnectTimer();
        this.reconnectAttempts = 0;
        this.manualDisconnectRequested = false;
        this.stopRequested = false;
        LOG.info(`Successfully connected to ${packet.museName}`);

        if (this.disconnectStartedAtMs !== null) {
          this.markConnectionRestored();
        }

        // Check if we need to configure the preset
        if (!this.presetConfigured) {
          // First connection - set the preset (this will cause disconnect/reconnect)
          LOG.info('First connection - applying PRESET_1035...');
          try {
            this.museCore.setPreset(this.MUSE_2025_PRESET);
            this.presetConfigured = true;
            this.expectingPresetReconnect = true;
            
            // Clear any existing preset reconnect timer
            this.clearPresetReconnectTimer();
            
            // Set a 30-second timeout for device to reconnect with new preset
            this.presetReconnectTimer = setTimeout(() => {
              this.presetReconnectTimer = null;
              if (this.expectingPresetReconnect && !this.isConnected) {
                LOG.error('Preset reconnect timeout: Device did not reconnect within 30s after preset change');
                this.expectingPresetReconnect = false;
                this.presetConfigured = false;
                // Attempt to reconnect manually
                if (this.targetDeviceId) {
                  this.scheduleReconnect('preset_reconnect_timeout');
                }
              }
            }, 30000);
            
            LOG.info('Preset set - device will disconnect and reconnect with PRESET_1035');
          } catch (err) {
            LOG.error('Failed to set preset', err);
            // If preset fails, enable streaming anyway with default preset
            this.presetConfigured = true;
            this.expectingPresetReconnect = false;
            this.enableStreaming();
          }
        } else {
          // Second connection (after preset applied) - now enable data transmission
          this.expectingPresetReconnect = false;
          this.clearPresetReconnectTimer();
          LOG.info('Reconnected with PRESET_1035 - EEG and quality listeners active');
          this.enableStreaming();
        }
      } else if (packet.currentState === ConnectionState.DISCONNECTED) {
        const wasConnected = this.isConnected;
        const disconnectedDeviceId = this.currentDeviceId ?? this.targetDeviceId;
        const disconnectedDeviceName = this.currentDeviceName ?? packet.museName;
        this.isConnected = false;
        this.currentDeviceId = null;
        this.currentDeviceName = null;
        this.lastBatteryLevel = 0;
        this.lastBatteryUpdatedAtMs = null;
        this.lastHsiValues = [undefined, undefined, undefined, undefined];
        this.lastHsiUpdatedAtMs = null;
        this.lastSavedMetadata = null;
        this.clearAllBuffers();
        LOG.info(`Disconnected from ${packet.museName}`);

        if (this.expectingPresetReconnect) {
          LOG.info('Disconnect expected while applying PRESET_1035, waiting for automatic reconnect');
          return;
        }

        if (this.stopRequested || this.manualDisconnectRequested) {
          LOG.info('Disconnect was requested by app, skipping auto-reconnect');
          this.clearReconnectTimer();
          this.disconnectStartedAtMs = null;
          this.reconnectAttempts = 0;
          this.manualDisconnectRequested = false;
          return;
        }

        if (wasConnected) {
          this.markConnectionDropped('unexpected_disconnect', disconnectedDeviceId, disconnectedDeviceName);
        }
        this.scheduleReconnect('unexpected_disconnect');
      } else if (packet.currentState === ConnectionState.CONNECTING) {
        LOG.info(`Connecting to ${packet.museName}...`);
      }
    });

    // EEG data
    this.museCore.on('eegData', (packet: DataPacket) => {
      this.eegBuffer.push({ ...packet, receivedAtMs: Date.now() });
    });

    this.museCore.on('opticsData', (packet: DataPacket) => {
      this.opticsBuffer.push({ ...packet, receivedAtMs: Date.now() });
    });

    // Keep battery + HSI quality metadata because it is still valuable for raw EEG quality checks.
    this.museCore.on('batteryData', (packet: DataPacket) => {
      const now = Date.now();
      const channels = packet.channels as any;
      if (channels && typeof channels.chargePercentage === 'number') {
        this.lastBatteryLevel = channels.chargePercentage;
        this.lastBatteryUpdatedAtMs = now;
      } else if (packet.values && packet.values.length > 0) {
        const value = packet.values[0];
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.lastBatteryLevel = value;
          this.lastBatteryUpdatedAtMs = now;
        }
      }
    });

    this.museCore.on('hsiData', (packet: DataPacket) => {
      const parsedValues = this.extractHsiValues(packet);
      if (parsedValues.some((value) => value !== undefined)) {
        this.lastHsiValues = [
          parsedValues[0] ?? this.lastHsiValues[0],
          parsedValues[1] ?? this.lastHsiValues[1],
          parsedValues[2] ?? this.lastHsiValues[2],
          parsedValues[3] ?? this.lastHsiValues[3]
        ];
        this.lastHsiUpdatedAtMs = Date.now();
        return;
      }

      // Some SDK builds provide a single scalar HSI quality value instead of 4 channels.
      const scalarHsi =
        (packet.values?.length ?? 0) === 1 ? this.toFiniteNumber(packet.values?.[0]) : undefined;
      if (scalarHsi !== undefined) {
        this.lastHsiValues = [scalarHsi, scalarHsi, scalarHsi, scalarHsi];
        this.lastHsiUpdatedAtMs = Date.now();
      }
    });

    // Errors
    this.museCore.on('error', (error: Error) => {
      LOG.error('Muse device error', error);
    });

    this.museCore.on('discoveryDebug', (payload: any) => {
      const source = payload?.source ?? 'unknown';
      const listening = payload?.listening ?? false;
      const muses = payload?.muses ?? 0;
      const cached = payload?.cached ?? 0;
      const preview = payload?.preview ? ` preview=[${payload.preview}]` : '';
      LOG.info(`[muse-discovery][${source}] listening=${listening} muses=${muses} cached=${cached}${preview}`);
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

  private toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private extractHsiValues(
    packet: DataPacket
  ): [number | undefined, number | undefined, number | undefined, number | undefined] {
    const values = packet.values?.slice(0, 4).map((value) => this.toFiniteNumber(value));
    if (values && values.length >= 4) {
      return [values[0], values[1], values[2], values[3]];
    }

    const channels = packet.channels as Record<string, unknown> | undefined;
    if (!channels) {
      return [undefined, undefined, undefined, undefined];
    }

    const read = (...keys: string[]): number | undefined => {
      for (const key of keys) {
        const parsed = this.toFiniteNumber(channels[key]);
        if (parsed !== undefined) {
          return parsed;
        }
      }
      return undefined;
    };

    const tp9 = read('tp9', 'hsiTp9', 'ch0', 'eeg1');
    const af7 = read('af7', 'hsiAf7', 'ch1', 'eeg2');
    const af8 = read('af8', 'hsiAf8', 'ch2', 'eeg3');
    const tp10 = read('tp10', 'hsiTp10', 'ch3', 'eeg4');

    return [tp9, af7, af8, tp10];
  }

  /**
   * Enable data streaming after connection and preset configuration
   */
  private enableStreaming(): void {
    try {
      this.museCore.startStreaming();
      LOG.info('Data transmission enabled (EEG + optics + quality metadata)');
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
      this.stopRequested = false;
      this.manualDisconnectRequested = false;
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;

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
      this.stopRequested = true;
      this.clearReconnectTimer();
      this.clearPresetReconnectTimer();

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
      this.expectingPresetReconnect = false;
      this.lastSavedMetadata = null;
      this.savedSamplesSinceProgressLog = 0;
      this.lastSaveProgressLogMs = 0;
      this.disconnectStartedAtMs = null;
      this.reconnectAttempts = 0;
      this.manualDisconnectRequested = false;
      this.targetDeviceId = null;

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
      this.targetDeviceId = macAddress;
      this.stopRequested = false;
      this.manualDisconnectRequested = false;
      this.clearReconnectTimer();
      this.clearPresetReconnectTimer();

      // Check if device was discovered
      const devices = this.museCore.getDiscoveredDevices();
      LOG.debug(`Available devices for connection: ${JSON.stringify(devices)}`);

      const deviceFound = devices.find((d: MuseDevice) => d.macAddress === macAddress);
      if (!deviceFound) {
        LOG.warn(`Device ${macAddress} not found in discovered devices`);
      }

      // CRITICAL: macOS SDK requires stopping discovery before connecting.
      // Connecting while discovery is active causes instability/crashes.
      // See: libmuse SDK docs and MuseStats example.
      LOG.debug('Stopping device discovery before connection (macOS SDK requirement)');
      this.museCore.stopDiscovery();

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
      this.manualDisconnectRequested = true;
      this.clearReconnectTimer();
      this.museCore.disconnect();
      this.isConnected = false;
      this.currentDeviceId = null;
      this.currentDeviceName = null;
      this.presetConfigured = false; // Reset for next connection
      this.expectingPresetReconnect = false;
      this.disconnectStartedAtMs = null;
      this.reconnectAttempts = 0;
    } catch (error) {
      LOG.error('Failed to disconnect device', error);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPresetReconnectTimer(): void {
    if (this.presetReconnectTimer) {
      clearTimeout(this.presetReconnectTimer);
      this.presetReconnectTimer = null;
    }
  }

  private scheduleReconnect(reason: string): void {
    if (!this.isRunning || !this.nativeAvailable || !this.museCore || this.isConnected) {
      return;
    }

    if (this.stopRequested || this.manualDisconnectRequested) {
      return;
    }

    const targetMacAddress = this.targetDeviceId;
    if (!targetMacAddress) {
      LOG.warn('Muse reconnect skipped: no target device id is available');
      return;
    }

    this.clearReconnectTimer();

    const attemptNumber = this.reconnectAttempts + 1;
    const delay = Math.min(
      this.RECONNECT_MAX_DELAY_MS,
      this.RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, attemptNumber - 1))
    );

    LOG.warn(
      `Muse disconnected (${reason}). Scheduling reconnect attempt ${attemptNumber} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.performReconnectAttempt(targetMacAddress);
    }, delay);
  }

  private async performReconnectAttempt(targetMacAddress: string): Promise<void> {
    if (!this.isRunning || !this.nativeAvailable || !this.museCore || this.isConnected) {
      return;
    }

    if (this.stopRequested || this.manualDisconnectRequested) {
      return;
    }

    const attemptNumber = this.reconnectAttempts + 1;
    this.reconnectAttempts = attemptNumber;

    try {
      LOG.info(`Attempting Muse reconnect #${attemptNumber} to ${targetMacAddress}`);
      await this.museCore.connect(targetMacAddress);

      if (!this.isConnected) {
        this.scheduleReconnect('connect_pending');
      }
    } catch (error) {
      LOG.warn(`Muse reconnect attempt #${attemptNumber} failed`, error);
      this.scheduleReconnect('connect_failed');
    }
  }

  private markConnectionDropped(
    reason: string,
    deviceId: string | null,
    deviceName: string | null
  ): void {
    if (this.disconnectStartedAtMs !== null) {
      return;
    }

    this.disconnectStartedAtMs = Date.now();

    const payload = {
      reason,
      droppedAt: new Date(this.disconnectStartedAtMs).toISOString(),
      deviceId,
      deviceName
    };

    void UsageDataService.createNewUsageDataEvent(
      UsageDataEventType.MuseConnectionDropped,
      JSON.stringify(payload)
    );
  }

  private markConnectionRestored(): void {
    if (this.disconnectStartedAtMs === null) {
      return;
    }

    const restoredAtMs = Date.now();
    const payload = {
      droppedAt: new Date(this.disconnectStartedAtMs).toISOString(),
      restoredAt: new Date(restoredAtMs).toISOString(),
      outageDurationMs: restoredAtMs - this.disconnectStartedAtMs,
      reconnectAttempts: this.reconnectAttempts,
      deviceId: this.targetDeviceId,
      deviceName: this.currentDeviceName
    };

    this.disconnectStartedAtMs = null;

    void UsageDataService.createNewUsageDataEvent(
      UsageDataEventType.MuseConnectionRestored,
      JSON.stringify(payload)
    );
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

  public getLiveQualitySnapshot(): {
    batteryLevel?: number;
    hsiTp9?: number;
    hsiAf7?: number;
    hsiAf8?: number;
    hsiTp10?: number;
    signalQuality?: number;
    updatedAtMs: number | null;
  } {
    const [hsiTp9, hsiAf7, hsiAf8, hsiTp10] = this.lastHsiValues;
    const signalQuality = this.computeSignalQualityFromHsi([hsiTp9, hsiAf7, hsiAf8, hsiTp10]);
    const updatedAtCandidates = [this.lastBatteryUpdatedAtMs, this.lastHsiUpdatedAtMs].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );

    return {
      batteryLevel: this.lastBatteryUpdatedAtMs !== null ? this.lastBatteryLevel : undefined,
      hsiTp9,
      hsiAf7,
      hsiAf8,
      hsiTp10,
      signalQuality,
      updatedAtMs: updatedAtCandidates.length > 0 ? Math.max(...updatedAtCandidates) : null
    };
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
    if (this.aggregateAndSaveInFlight) {
      return this.aggregateAndSaveInFlight;
    }

    this.aggregateAndSaveInFlight = this.aggregateAndSaveInternal();
    try {
      await this.aggregateAndSaveInFlight;
    } finally {
      this.aggregateAndSaveInFlight = null;
    }
  }

  private async aggregateAndSaveInternal(): Promise<void> {
    if (!this.isConnected || !this.currentDeviceId) {
      return;
    }

    try {
      // Drain buffers first so failed writes do not keep retrying the same growing payload.
      const eegPackets = this.eegBuffer;
      const opticsPackets = this.opticsBuffer;
      this.clearAllBuffers();

      const rawEegSamples = this.extractRawEegSamples(eegPackets);
      const rawOpticsSamples = this.extractRawOpticsSamples(opticsPackets);

      if (rawEegSamples.length > 0 || rawOpticsSamples.length > 0) {
        await Promise.all([
          MuseTrackerService.saveRawEegBatch(rawEegSamples),
          MuseTrackerService.saveRawOpticsBatch(rawOpticsSamples)
        ]);

        if (rawEegSamples.length > 0) {
          await this.saveMetadataOnChange(rawEegSamples[rawEegSamples.length - 1].timestamp);
        }

        this.savedSamplesSinceProgressLog += rawEegSamples.length;

        const now = Date.now();
        const elapsedMs = now - this.lastSaveProgressLogMs;
        if (elapsedMs >= this.SAVE_PROGRESS_LOG_INTERVAL_MS) {
          LOG.info(
            `Saving active: ${this.savedSamplesSinceProgressLog} raw EEG samples and ${rawOpticsSamples.length} raw optics samples persisted in the last ${Math.round(elapsedMs / 1000)}s`
          );
          this.savedSamplesSinceProgressLog = 0;
          this.lastSaveProgressLogMs = now;
        }
      }
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
    const signalQuality = this.computeSignalQualityFromHsi([hsiTp9, hsiAf7, hsiAf8, hsiTp10]);
    const batteryLevel = this.lastBatteryUpdatedAtMs !== null ? this.lastBatteryLevel : undefined;

    const metadata: MetadataSample = {
      timestamp,
      batteryLevel,
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

  private computeSignalQualityFromHsi(
    values: Array<number | undefined>
  ): number | undefined {
    const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value)) as number[];
    return valid.length > 0 ? valid.reduce((worst, value) => Math.max(worst, value), 0) : undefined;
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

  private extractRawEegSamples(sourceBuffer: DataPacket[] = this.eegBuffer): RawEegSample[] {
    if (!this.isConnected) {
      return [];
    }

    const samples: RawEegSample[] = [];

    for (const packet of sourceBuffer) {
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

  private extractRawOpticsSamples(sourceBuffer: DataPacket[] = this.opticsBuffer): RawOpticsSample[] {
    if (!this.isConnected) {
      return [];
    }

    const samples: RawOpticsSample[] = [];

    for (const packet of sourceBuffer) {
      const channels = packet.channels as any;
      const values = packet.values;

      const ch0 = channels?.ch0 ?? values?.[0];
      const ch1 = channels?.ch1 ?? values?.[1];
      const ch2 = channels?.ch2 ?? values?.[2];
      const ch3 = channels?.ch3 ?? values?.[3];

      if (![ch0, ch1, ch2, ch3].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        continue;
      }

      const receivedAtMs =
        typeof packet.receivedAtMs === 'number' && Number.isFinite(packet.receivedAtMs)
          ? packet.receivedAtMs
          : Date.now();

      samples.push({
        timestamp: new Date(receivedAtMs),
        ch0,
        ch1,
        ch2,
        ch3
      });
    }

    return samples;
  }

  private clearAllBuffers(): void {
    this.eegBuffer = [];
    this.opticsBuffer = [];
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
