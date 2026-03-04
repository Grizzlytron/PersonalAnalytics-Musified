import { EventEmitter } from 'events';

// Import the native module
let nativeAddon: any;
try {
  nativeAddon = require('muse-native');
} catch (error) {
  console.error('[MuseTrackerCore] ERROR: Failed to load muse-native module:', error);
  throw error;
}

// Enums from native module
export enum ConnectionState {
  DISCONNECTED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
  NEEDS_UPDATE = 3,
  UNKNOWN = 4
}

// Values MUST match the libmuse SDK's MuseDataPacketType enum exactly,
// because the native addon does static_cast<int>() in both directions.
export enum DataPacketType {
  ACCELEROMETER = 0,
  GYRO = 1,
  EEG = 2,
  DROPPED_ACCELEROMETER = 3,
  DROPPED_EEG = 4,
  QUANTIZATION = 5,
  BATTERY = 6,
  DRL_REF = 7,
  ALPHA_ABSOLUTE = 8,
  BETA_ABSOLUTE = 9,
  DELTA_ABSOLUTE = 10,
  THETA_ABSOLUTE = 11,
  GAMMA_ABSOLUTE = 12,
  ALPHA_RELATIVE = 13,
  BETA_RELATIVE = 14,
  DELTA_RELATIVE = 15,
  THETA_RELATIVE = 16,
  GAMMA_RELATIVE = 17,
  ALPHA_SCORE = 18,
  BETA_SCORE = 19,
  DELTA_SCORE = 20,
  THETA_SCORE = 21,
  GAMMA_SCORE = 22,
  IS_GOOD = 23,
  HSI = 24,
  HSI_PRECISION = 25,
  ARTIFACTS = 26,
  MAGNETOMETER = 27,
  PRESSURE = 28,
  TEMPERATURE = 29,
  ULTRA_VIOLET = 30,
  NOTCH_FILTERED_EEG = 31,
  VARIANCE_EEG = 32,
  VARIANCE_NOTCH_FILTERED_EEG = 33,
  PPG = 34,
  IS_PPG_GOOD = 35,
  IS_HEART_GOOD = 36,
  THERMISTOR = 37,
  IS_THERMISTOR_GOOD = 38,
  AVG_BODY_TEMPERATURE = 39,
  CLOUD_COMPUTED = 40,
  OPTICS = 41,
  TOTAL = 42
}

// Interfaces
export interface MuseDevice {
  name: string;
  macAddress: string;
  model: string;
  connectionState: number;
  rssi: number;
}

export interface ConnectionPacket {
  currentState: ConnectionState;
  previousState: ConnectionState;
  museName: string;
}

export interface DataPacket {
  packetType: number;
  timestamp: number;
  values?: number[];
  channels?: { [key: string]: number };
}

export interface IMuseTracker {
  readonly name: string;
  isRunning: boolean;
  start(): void;
  stop(): void;
}

// Event types
interface MuseTrackerEvents {
  deviceDiscovered: (device: MuseDevice) => void;
  deviceListUpdated: (devices: MuseDevice[]) => void;
  connectionStateChanged: (packet: ConnectionPacket) => void;
  // Raw sensor data
  eegData: (packet: DataPacket) => void;
  ppgData: (packet: DataPacket) => void;
  opticsData: (packet: DataPacket) => void;
  accelerometerData: (packet: DataPacket) => void;
  gyroData: (packet: DataPacket) => void;
  batteryData: (packet: DataPacket) => void;
  drlRefData: (packet: DataPacket) => void;
  // Band power - Absolute
  alphaAbsoluteData: (packet: DataPacket) => void;
  betaAbsoluteData: (packet: DataPacket) => void;
  deltaAbsoluteData: (packet: DataPacket) => void;
  thetaAbsoluteData: (packet: DataPacket) => void;
  gammaAbsoluteData: (packet: DataPacket) => void;
  // Band power - Relative
  alphaRelativeData: (packet: DataPacket) => void;
  betaRelativeData: (packet: DataPacket) => void;
  deltaRelativeData: (packet: DataPacket) => void;
  thetaRelativeData: (packet: DataPacket) => void;
  gammaRelativeData: (packet: DataPacket) => void;
  // Band power - Scores
  alphaScoreData: (packet: DataPacket) => void;
  betaScoreData: (packet: DataPacket) => void;
  deltaScoreData: (packet: DataPacket) => void;
  thetaScoreData: (packet: DataPacket) => void;
  gammaScoreData: (packet: DataPacket) => void;
  // Quality indicators
  hsiData: (packet: DataPacket) => void;
  isGoodData: (packet: DataPacket) => void;
  artifactsData: (packet: DataPacket) => void;
  // Derived EEG values
  notchFilteredEegData: (packet: DataPacket) => void;
  varianceEegData: (packet: DataPacket) => void;
  varianceNotchFilteredEegData: (packet: DataPacket) => void;
  // General events
  data: (packet: DataPacket) => void;
  error: (error: Error) => void;
}

export declare interface MuseTrackerCore {
  on<K extends keyof MuseTrackerEvents>(event: K, listener: MuseTrackerEvents[K]): this;
  emit<K extends keyof MuseTrackerEvents>(
    event: K,
    ...args: Parameters<MuseTrackerEvents[K]>
  ): boolean;
}

/**
 * Core Muse tracker implementation using native libmuse bindings
 */
export class MuseTrackerCore extends EventEmitter implements IMuseTracker {
  public readonly name: string = 'MuseTrackerCore';
  public isRunning: boolean = false;

  private manager: any;
  private connectedMuse: any | null = null;
  private isScanning: boolean = false;
  private discoveredDevices: Map<string, MuseDevice> = new Map();
  private dataBuffers: {
    // Raw sensor data
    eeg: DataPacket[];
    ppg: DataPacket[];
    optics: DataPacket[];
    accelerometer: DataPacket[];
    gyro: DataPacket[];
    battery: DataPacket[];
    drlRef: DataPacket[];
    // Band power - Absolute
    alphaAbsolute: DataPacket[];
    betaAbsolute: DataPacket[];
    deltaAbsolute: DataPacket[];
    thetaAbsolute: DataPacket[];
    gammaAbsolute: DataPacket[];
    // Band power - Relative
    alphaRelative: DataPacket[];
    betaRelative: DataPacket[];
    deltaRelative: DataPacket[];
    thetaRelative: DataPacket[];
    gammaRelative: DataPacket[];
    // Band power - Scores
    alphaScore: DataPacket[];
    betaScore: DataPacket[];
    deltaScore: DataPacket[];
    thetaScore: DataPacket[];
    gammaScore: DataPacket[];
    // Quality indicators
    hsi: DataPacket[];
    isGood: DataPacket[];
    artifacts: DataPacket[];
    // Derived EEG values
    notchFilteredEeg: DataPacket[];
    varianceEeg: DataPacket[];
    varianceNotchFilteredEeg: DataPacket[];
  };
  private bufferSize: number;
  private lastBatteryLevel: number = 0;
  private dataReceptionCount: number = 0;
  private lastDataReceptionLog: number = 0;

  private verbose: boolean = false; // Set to true for debugging

  private log(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log('[MuseTrackerCore]', message, ...args);
    }
  }

  private logError(message: string, ...args: any[]): void {
    console.error('[MuseTrackerCore] ERROR:', message, ...args);
  }

  private logWarn(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.warn('[MuseTrackerCore] WARNING:', message, ...args);
    }
  }

  constructor(bufferSize: number = 1000) {
    super();
    this.bufferSize = bufferSize;
    this.dataBuffers = {
      // Raw sensor data
      eeg: [],
      ppg: [],
      optics: [],
      accelerometer: [],
      gyro: [],
      battery: [],
      drlRef: [],
      // Band power - Absolute
      alphaAbsolute: [],
      betaAbsolute: [],
      deltaAbsolute: [],
      thetaAbsolute: [],
      gammaAbsolute: [],
      // Band power - Relative
      alphaRelative: [],
      betaRelative: [],
      deltaRelative: [],
      thetaRelative: [],
      gammaRelative: [],
      // Band power - Scores
      alphaScore: [],
      betaScore: [],
      deltaScore: [],
      thetaScore: [],
      gammaScore: [],
      // Quality indicators
      hsi: [],
      isGood: [],
      artifacts: [],
      // Derived EEG values
      notchFilteredEeg: [],
      varianceEeg: [],
      varianceNotchFilteredEeg: []
    };

    try {
      this.log('Initializing MuseManager...');
      this.manager = nativeAddon.MuseManager.getInstance();
      this.log('MuseManager initialized:', !!this.manager);
      this.log('MuseManager type:', typeof this.manager);
      this.log(
        'MuseManager methods:',
        Object.getOwnPropertyNames(Object.getPrototypeOf(this.manager))
      );
      this.setupMuseListener();
      this.log('Constructor completed successfully');
    } catch (error) {
      this.logError('Failed to initialize MuseManager:', error);
      throw error;
    }
  }

  private setupMuseListener(): void {
    this.log('Setting up muse listener...');
    try {
      // The native muse_list_changed callback is a notification with no arguments.
      // We must call manager.getMuses() ourselves to get the updated device list.
      this.manager.setMuseListener(() => {
        this.log('Muse list changed notification received');
        const devices: MuseDevice[] = [];

        try {
          const muses = this.manager.getMuses();

          if (!Array.isArray(muses)) {
            this.logWarn('getMuses() did not return an array');
            this.emit('deviceListUpdated', devices);
            return;
          }

          this.log('Device list updated:', muses.length, 'devices');

          for (let i = 0; i < muses.length; i++) {
            const muse = muses[i];
            try {
              const device: MuseDevice = {
                name: muse.getName(),
                macAddress: muse.getMacAddress(),
                model: muse.getModel(),
                connectionState: muse.getConnectionState(),
                rssi: muse.getRssi()
              };
              devices.push(device);

              if (!this.discoveredDevices.has(device.macAddress)) {
                this.discoveredDevices.set(device.macAddress, device);
                this.log('NEW device discovered:', device.name, device.macAddress);
                this.emit('deviceDiscovered', device);
              }
            } catch (err) {
              this.logError(`Error getting device ${i} info:`, err);
            }
          }
        } catch (err) {
          this.logError('Error calling getMuses() in listener:', err);
        }

        this.log(`Emitting deviceListUpdated with ${devices.length} devices`);
        this.emit('deviceListUpdated', devices);
      });
      this.log('Listener registered successfully');
    } catch (err) {
      this.logError('Failed to set muse listener:', err);
      throw err;
    }
  }

  /**
   * Start scanning for Muse devices
   */
  public start(): void {
    if (this.isRunning) {
      this.log('start() called but already running');
      return;
    }

    try {
      this.log('START called');
      this.discoveredDevices.clear();

      this.log('Calling manager.startListening()...');
      const result = this.manager.startListening();
      this.log('startListening() result:', result);

      this.isScanning = true;
      this.isRunning = true;

      this.log('Starting polling...');
      this.pollForDevices();
    } catch (err) {
      this.logError('ERROR in start():', err);
      this.emit('error', err as Error);
    }
  }

  /**
   * Poll for discovered devices periodically
   */
  private pollForDevices(): void {
    if (!this.isRunning || !this.isScanning) {
      return;
    }

    try {
      const muses = this.manager.getMuses();

      const devices: MuseDevice[] = [];

      if (Array.isArray(muses)) {
        for (const muse of muses) {
          try {
            const device: MuseDevice = {
              name: muse.getName(),
              macAddress: muse.getMacAddress(),
              model: muse.getModel(),
              connectionState: muse.getConnectionState(),
              rssi: muse.getRssi()
            };

            devices.push(device);

            // Check if this is a new device
            if (!this.discoveredDevices.has(device.macAddress)) {
              this.discoveredDevices.set(device.macAddress, device);
              this.log('NEW device discovered:', device.name, device.macAddress);
              this.emit('deviceDiscovered', device);
            } else {
              // Update existing device info (RSSI might have changed)
              const existingDevice = this.discoveredDevices.get(device.macAddress);
              if (existingDevice && existingDevice.rssi !== device.rssi) {
                this.discoveredDevices.set(device.macAddress, device);
              }
            }
          } catch (err) {
            this.logError('Error getting device info:', err);
          }
        }
      }

      // Only emit if we have devices
      if (devices.length > 0) {
        this.emit('deviceListUpdated', devices);
      }
    } catch (err) {
      this.logError('Error polling for devices:', err);
    }

    // Continue polling every 500ms while running and scanning
    if (this.isRunning && this.isScanning) {
      setTimeout(() => this.pollForDevices(), 500);
    }
  }

  /**
   * Stop scanning for Muse devices
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    try {
      this.manager.stopListening();
      this.disconnect();
      this.isScanning = false;
      this.isRunning = false;
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Get list of discovered devices
   */
  public getDiscoveredDevices(): MuseDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Connect to a Muse device by MAC address
   */
  public async connect(macAddress: string): Promise<void> {
    const muses = this.manager.getMuses();
    const muse = muses.find((m: any) => m.getMacAddress() === macAddress);

    if (!muse) {
      throw new Error(`Muse device with MAC address ${macAddress} not found`);
    }

    // Store the muse for data listener registration
    this.connectedMuse = muse;

    // Set up connection listener
    muse.registerConnectionListener((packet: ConnectionPacket) => {
      this.emit('connectionStateChanged', packet);

      if (packet.currentState === ConnectionState.CONNECTED) {
        // Stop scanning for devices when connected
        this.isScanning = false;
        this.log('Device connected successfully - scanning stopped');
      } else if (packet.currentState === ConnectionState.DISCONNECTED) {
        this.connectedMuse = null;
        // Resume scanning for devices when disconnected
        if (this.isRunning && !this.isScanning) {
          this.isScanning = true;
          this.log('Device disconnected - resumed scanning for devices');
          this.pollForDevices();
        }
      }
    });

    // CRITICAL: Register ALL data listeners BEFORE calling runAsynchronously()
    // The SDK needs to know what data types to compute before starting the processing loop
    this.log('Registering all data listeners BEFORE connection...');
    this.registerAllDataListeners();
    this.log('All data listeners registered successfully');

    // Connect using runAsynchronously (starts processing with all listeners already registered)
    // Preset and enableDataTransmission will be called AFTER connection
    this.log('Calling runAsynchronously() to start connection...');
    muse.runAsynchronously();
  }

  /**
   * Disconnect from the currently connected Muse
   */
  public disconnect(): void {
    if (this.connectedMuse) {
      try {
        this.log('Disconnecting from device...');
        this.connectedMuse.disconnect();
        this.connectedMuse = null;
        this.log('Device disconnected successfully');
      } catch (err) {
        this.logError('Error disconnecting device:', err);
        this.emit('error', err as Error);
      }
    } else {
      this.log('No device connected to disconnect from');
    }
  }

  /**
   * Register a data listener for a specific packet type
   */
  public registerDataListener(packetType: number): void {
    if (!this.connectedMuse) {
      throw new Error('No Muse device connected');
    }

    const handler = (packet: DataPacket) => {
      // Add to buffer
      this.addToBuffer(packet);

      // Emit to general 'data' event
      this.emit('data', packet);

      // Emit to specific event based on type
      switch (packet.packetType) {
        // Raw sensor data
        case DataPacketType.EEG:
          this.emit('eegData', packet);
          break;
        case DataPacketType.PPG:
          this.emit('ppgData', packet);
          break;
        case DataPacketType.ACCELEROMETER:
          this.emit('accelerometerData', packet);
          break;
        case DataPacketType.GYRO:
          this.emit('gyroData', packet);
          break;
        case DataPacketType.BATTERY:
          this.log('BATTERY DATA RECEIVED!', packet);
          this.emit('batteryData', packet);
          break;
        case DataPacketType.OPTICS:
          this.emit('opticsData', packet);
          break;
        case DataPacketType.DRL_REF:
          this.emit('drlRefData', packet);
          break;
        // Band power - Absolute
        case DataPacketType.ALPHA_ABSOLUTE:
          this.emit('alphaAbsoluteData', packet);
          break;
        case DataPacketType.BETA_ABSOLUTE:
          this.emit('betaAbsoluteData', packet);
          break;
        case DataPacketType.DELTA_ABSOLUTE:
          this.emit('deltaAbsoluteData', packet);
          break;
        case DataPacketType.THETA_ABSOLUTE:
          this.emit('thetaAbsoluteData', packet);
          break;
        case DataPacketType.GAMMA_ABSOLUTE:
          this.emit('gammaAbsoluteData', packet);
          break;
        // Band power - Relative
        case DataPacketType.ALPHA_RELATIVE:
          this.emit('alphaRelativeData', packet);
          break;
        case DataPacketType.BETA_RELATIVE:
          this.emit('betaRelativeData', packet);
          break;
        case DataPacketType.DELTA_RELATIVE:
          this.emit('deltaRelativeData', packet);
          break;
        case DataPacketType.THETA_RELATIVE:
          this.emit('thetaRelativeData', packet);
          break;
        case DataPacketType.GAMMA_RELATIVE:
          this.emit('gammaRelativeData', packet);
          break;
        // Band power - Scores
        case DataPacketType.ALPHA_SCORE:
          this.emit('alphaScoreData', packet);
          break;
        case DataPacketType.BETA_SCORE:
          this.emit('betaScoreData', packet);
          break;
        case DataPacketType.DELTA_SCORE:
          this.emit('deltaScoreData', packet);
          break;
        case DataPacketType.THETA_SCORE:
          this.emit('thetaScoreData', packet);
          break;
        case DataPacketType.GAMMA_SCORE:
          this.emit('gammaScoreData', packet);
          break;
        // Quality indicators
        case DataPacketType.HSI_PRECISION:
          this.emit('hsiData', packet);
          break;
        case DataPacketType.IS_GOOD:
          this.emit('isGoodData', packet);
          break;
        case DataPacketType.ARTIFACTS:
          this.emit('artifactsData', packet);
          break;
        // Derived EEG values
        case DataPacketType.NOTCH_FILTERED_EEG:
          this.emit('notchFilteredEegData', packet);
          break;
        case DataPacketType.VARIANCE_EEG:
          this.emit('varianceEegData', packet);
          break;
        case DataPacketType.VARIANCE_NOTCH_FILTERED_EEG:
          this.emit('varianceNotchFilteredEegData', packet);
          break;
      }
    };

    this.connectedMuse.registerDataListener(packetType, handler);
  }

  private addToBuffer(packet: DataPacket): void {
    let buffer: DataPacket[];

    switch (packet.packetType) {
      // Raw sensor data
      case DataPacketType.EEG:
        buffer = this.dataBuffers.eeg;
        break;
      case DataPacketType.PPG:
        buffer = this.dataBuffers.ppg;
        break;
      case DataPacketType.ACCELEROMETER:
        buffer = this.dataBuffers.accelerometer;
        break;
      case DataPacketType.GYRO:
        buffer = this.dataBuffers.gyro;
        break;
      case DataPacketType.BATTERY:
        buffer = this.dataBuffers.battery;
        break;
      case DataPacketType.OPTICS:
        buffer = this.dataBuffers.optics;
        break;
      case DataPacketType.DRL_REF:
        buffer = this.dataBuffers.drlRef;
        break;
      // Band power - Absolute
      case DataPacketType.ALPHA_ABSOLUTE:
        buffer = this.dataBuffers.alphaAbsolute;
        break;
      case DataPacketType.BETA_ABSOLUTE:
        buffer = this.dataBuffers.betaAbsolute;
        break;
      case DataPacketType.DELTA_ABSOLUTE:
        buffer = this.dataBuffers.deltaAbsolute;
        break;
      case DataPacketType.THETA_ABSOLUTE:
        buffer = this.dataBuffers.thetaAbsolute;
        break;
      case DataPacketType.GAMMA_ABSOLUTE:
        buffer = this.dataBuffers.gammaAbsolute;
        break;
      // Band power - Relative
      case DataPacketType.ALPHA_RELATIVE:
        buffer = this.dataBuffers.alphaRelative;
        break;
      case DataPacketType.BETA_RELATIVE:
        buffer = this.dataBuffers.betaRelative;
        break;
      case DataPacketType.DELTA_RELATIVE:
        buffer = this.dataBuffers.deltaRelative;
        break;
      case DataPacketType.THETA_RELATIVE:
        buffer = this.dataBuffers.thetaRelative;
        break;
      case DataPacketType.GAMMA_RELATIVE:
        buffer = this.dataBuffers.gammaRelative;
        break;
      // Band power - Scores
      case DataPacketType.ALPHA_SCORE:
        buffer = this.dataBuffers.alphaScore;
        break;
      case DataPacketType.BETA_SCORE:
        buffer = this.dataBuffers.betaScore;
        break;
      case DataPacketType.DELTA_SCORE:
        buffer = this.dataBuffers.deltaScore;
        break;
      case DataPacketType.THETA_SCORE:
        buffer = this.dataBuffers.thetaScore;
        break;
      case DataPacketType.GAMMA_SCORE:
        buffer = this.dataBuffers.gammaScore;
        break;
      // Quality indicators
      case DataPacketType.HSI_PRECISION:
        buffer = this.dataBuffers.hsi;
        break;
      case DataPacketType.IS_GOOD:
        buffer = this.dataBuffers.isGood;
        break;
      case DataPacketType.ARTIFACTS:
        buffer = this.dataBuffers.artifacts;
        break;
      // Derived EEG values
      case DataPacketType.NOTCH_FILTERED_EEG:
        buffer = this.dataBuffers.notchFilteredEeg;
        break;
      case DataPacketType.VARIANCE_EEG:
        buffer = this.dataBuffers.varianceEeg;
        break;
      case DataPacketType.VARIANCE_NOTCH_FILTERED_EEG:
        buffer = this.dataBuffers.varianceNotchFilteredEeg;
        break;
      default:
        return;
    }

    buffer.push(packet);

    // Keep buffer size limited
    if (buffer.length > this.bufferSize) {
      buffer.shift();
    }
  }

  /**
   * Set the device preset before connecting.
   * For Muse S 2025, use PRESET_1035 for EEG + low-power Optics (battery optimized).
   * Must be called on the connected Muse object before or after connection.
   * Note: changing preset while connected will cause a reconnect.
   */
  public setPreset(preset: number): void {
    if (!this.connectedMuse) {
      throw new Error('No Muse device connected');
    }
    this.log(`Setting preset: ${preset}`);
    this.connectedMuse.setPreset(preset);
  }

  /**
   * Start streaming data types optimized for battery life.
   * Only registers EEG, OPTICS (for heart rate), and BATTERY listeners.
   * Accelerometer and Gyro are omitted to save battery.
   */
  /**
   * Start streaming all data types for ML analysis.
   * Registers listeners for all Muse S 2025 supported data:
   * - Raw sensors (EEG, Accelerometer, Gyro, Optics, Battery, DRL_REF)
   * - All frequency band powers (Alpha, Beta, Delta, Theta, Gamma - Absolute, Relative, Scores)
  * - Quality indicators (HSI_PRECISION, IS_GOOD, ARTIFACTS)
   * - Derived EEG values (Notch Filtered, Variance)
   */
  /**
   * Register all data listeners - MUST be called before runAsynchronously()
   * The SDK needs to know what data types to compute before starting the processing loop
   */
  private registerAllDataListeners(): void {
    if (!this.connectedMuse) {
      throw new Error('No Muse device available for listener registration');
    }

    this.log('Registering all data listeners for ML analysis...');
    
    // Raw sensor data
    this.registerDataListener(DataPacketType.EEG);
    this.registerDataListener(DataPacketType.ACCELEROMETER);
    this.registerDataListener(DataPacketType.GYRO);
    this.registerDataListener(DataPacketType.OPTICS);
    this.registerDataListener(DataPacketType.BATTERY);
    this.registerDataListener(DataPacketType.DRL_REF);

    // Band power - Absolute
    this.registerDataListener(DataPacketType.ALPHA_ABSOLUTE);
    this.registerDataListener(DataPacketType.BETA_ABSOLUTE);
    this.registerDataListener(DataPacketType.DELTA_ABSOLUTE);
    this.registerDataListener(DataPacketType.THETA_ABSOLUTE);
    this.registerDataListener(DataPacketType.GAMMA_ABSOLUTE);

    // Band power - Relative (best for ML - normalized 0-1)
    this.registerDataListener(DataPacketType.ALPHA_RELATIVE);
    this.registerDataListener(DataPacketType.BETA_RELATIVE);
    this.registerDataListener(DataPacketType.DELTA_RELATIVE);
    this.registerDataListener(DataPacketType.THETA_RELATIVE);
    this.registerDataListener(DataPacketType.GAMMA_RELATIVE);

    // Band power - Scores (percentile-based)
    this.registerDataListener(DataPacketType.ALPHA_SCORE);
    this.registerDataListener(DataPacketType.BETA_SCORE);
    this.registerDataListener(DataPacketType.DELTA_SCORE);
    this.registerDataListener(DataPacketType.THETA_SCORE);
    this.registerDataListener(DataPacketType.GAMMA_SCORE);

    // Quality indicators
    this.registerDataListener(DataPacketType.HSI_PRECISION);
    this.registerDataListener(DataPacketType.IS_GOOD);
    this.registerDataListener(DataPacketType.ARTIFACTS);

    // Derived EEG values
    this.registerDataListener(DataPacketType.NOTCH_FILTERED_EEG);
    this.registerDataListener(DataPacketType.VARIANCE_EEG);
    this.registerDataListener(DataPacketType.VARIANCE_NOTCH_FILTERED_EEG);

    this.log('All data listeners registered (42 packet types)');
  }

  public startStreaming(): void {
    if (!this.connectedMuse) {
      const err = 'No Muse device connected';
      this.logError(err);
      throw new Error(err);
    }

    // Data listeners are already registered in connect() before runAsynchronously()
    // This method now just enables data transmission
    this.log('startStreaming() - data listeners already registered, enabling transmission...');
    try {
      this.connectedMuse.enableDataTransmission(true);
      this.log('Data transmission enabled - all streams active');
    } catch (err) {
      this.logError('ERROR enabling data transmission:', err);
      throw err;
    }
  }

  /**
   * Get the currently connected Muse device info
   */
  public getConnectedDevice(): MuseDevice | null {
    if (!this.connectedMuse) {
      return null;
    }

    return {
      name: this.connectedMuse.getName(),
      macAddress: this.connectedMuse.getMacAddress(),
      model: this.connectedMuse.getModel(),
      connectionState: this.connectedMuse.getConnectionState(),
      rssi: this.connectedMuse.getRssi()
    };
  }

  /**
   * Check if currently connected to a Muse
   */
  public isConnected(): boolean {
    return (
      this.connectedMuse !== null &&
      this.connectedMuse.getConnectionState() === ConnectionState.CONNECTED
    );
  }

  /**
   * Get buffered data
   */
  public getBufferedData(): typeof this.dataBuffers {
    return { ...this.dataBuffers };
  }

  /**
   * Clear all buffers
   */
  public clearBuffers(): void {
    this.dataBuffers.eeg = [];
    this.dataBuffers.ppg = [];
    this.dataBuffers.accelerometer = [];
    this.dataBuffers.gyro = [];
    this.dataBuffers.battery = [];
    this.dataBuffers.hsi = [];
  }

  /**
   * Diagnostic method to check native module state
   */
  public diagnose(): void {
    this.log('');
    this.log('========== MuseTrackerCore Diagnostics ==========');
    this.log('Manager instance:', !!this.manager);
    this.log('Manager type:', typeof this.manager);
    this.log('isRunning:', this.isRunning);
    this.log('isScanning:', this.isScanning);
    this.log('Connected device:', this.connectedMuse ? this.connectedMuse.getName() : 'None');
    this.log(
      'Data buffers - EEG:',
      this.dataBuffers.eeg.length,
      'PPG:',
      this.dataBuffers.ppg.length,
      'Accel:',
      this.dataBuffers.accelerometer.length
    );
    this.log('Discovered devices count:', this.discoveredDevices.size);
    this.log('Discovered devices:', Array.from(this.discoveredDevices.values()));

    try {
      this.log('');
      this.log('--- Attempting direct getMuses() call ---');
      const muses = this.manager.getMuses();
      this.log('getMuses() succeeded');
      this.log('  Type:', typeof muses);
      this.log('  Is array:', Array.isArray(muses));
      this.log('  Length:', Array.isArray(muses) ? muses.length : 'N/A');
      this.log('  Content:', muses);
    } catch (err) {
      this.logError('getMuses() failed:', err);
    }

    this.log('');
    this.log('--- Native module methods ---');
    try {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this.manager));
      this.log('Available methods:', methods);
    } catch (err) {
      this.logError('Failed to get methods:', err);
    }

    this.log('=================================================');
  }

  /**
   * Get data reception statistics
   */
  public getDataReceptionStats(): {
    eegCount: number;
    ppgCount: number;
    accelCount: number;
    gyroCount: number;
    batteryCount: number;
    total: number;
  } {
    return {
      eegCount: this.dataBuffers.eeg.length,
      ppgCount: this.dataBuffers.ppg.length,
      accelCount: this.dataBuffers.accelerometer.length,
      gyroCount: this.dataBuffers.gyro.length,
      batteryCount: this.dataBuffers.battery.length,
      total:
        this.dataBuffers.eeg.length +
        this.dataBuffers.ppg.length +
        this.dataBuffers.accelerometer.length +
        this.dataBuffers.gyro.length +
        this.dataBuffers.battery.length
    };
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.stop();
    this.removeAllListeners();
    this.clearBuffers();
  }
}

// Export singleton instance
let instance: MuseTrackerCore | null = null;

export function getMuseTrackerCore(): MuseTrackerCore {
  if (!instance) {
    instance = new MuseTrackerCore();
  }
  return instance;
}

export default MuseTrackerCore;
