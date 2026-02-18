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
    'deviceDiscovered': (device: MuseDevice) => void;
    'deviceListUpdated': (devices: MuseDevice[]) => void;
    'connectionStateChanged': (packet: ConnectionPacket) => void;
    'eegData': (packet: DataPacket) => void;
    'ppgData': (packet: DataPacket) => void;
    'opticsData': (packet: DataPacket) => void;
    'accelerometerData': (packet: DataPacket) => void;
    'gyroData': (packet: DataPacket) => void;
    'batteryData': (packet: DataPacket) => void;
    'hsiData': (packet: DataPacket) => void;
    'data': (packet: DataPacket) => void;
    'error': (error: Error) => void;
}

export declare interface MuseTrackerCore {
    on<K extends keyof MuseTrackerEvents>(event: K, listener: MuseTrackerEvents[K]): this;
    emit<K extends keyof MuseTrackerEvents>(event: K, ...args: Parameters<MuseTrackerEvents[K]>): boolean;
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
        eeg: DataPacket[];
        ppg: DataPacket[];
        optics: DataPacket[];
        accelerometer: DataPacket[];
        gyro: DataPacket[];
        battery: DataPacket[];
        hsi: DataPacket[];
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
            eeg: [],
            ppg: [],
            optics: [],
            accelerometer: [],
            gyro: [],
            battery: [],
            hsi: []
        };

        try {
            this.log('Initializing MuseManager...');
            this.manager = nativeAddon.MuseManager.getInstance();
            this.log('MuseManager initialized:', !!this.manager);
            this.log('MuseManager type:', typeof this.manager);
            this.log('MuseManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.manager)));
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
            this.manager.setMuseListener((museList: any[]) => {
                const devices: MuseDevice[] = [];
                
                if (!Array.isArray(museList)) {
                    this.logError('Device list is not an array');
                    this.emit('deviceListUpdated', devices);
                    return;
                }
                
                this.log('Device list updated:', museList.length, 'devices');
                
                for (let i = 0; i < museList.length; i++) {
                    const muse = museList[i];
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

        // Set up connection listener
        muse.registerConnectionListener((packet: ConnectionPacket) => {
            this.emit('connectionStateChanged', packet);
            
            if (packet.currentState === ConnectionState.CONNECTED) {
                this.connectedMuse = muse;
                // Stop scanning for devices when connected
                this.isScanning = false;
                this.log('Device connected - stopped scanning for new devices');
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

        // Connect using runAsynchronously
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
                case DataPacketType.HSI_PRECISION:
                    this.emit('hsiData', packet);
                    break;
            }
        };

        this.connectedMuse.registerDataListener(packetType, handler);
    }

    private addToBuffer(packet: DataPacket): void {
        let buffer: DataPacket[];
        
        switch (packet.packetType) {
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
            case DataPacketType.HSI_PRECISION:
                buffer = this.dataBuffers.hsi;
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
    public startStreaming(): void {
        if (!this.connectedMuse) {
            const err = 'No Muse device connected';
            this.logError(err);
            throw new Error(err);
        }
        
        this.log('startStreaming() called - registering data listeners (battery-optimized)...');
        try {
            this.registerDataListener(DataPacketType.EEG);
            this.log('EEG listener registered');
            this.registerDataListener(DataPacketType.OPTICS);
            this.log('OPTICS listener registered (for heart rate)');
            this.registerDataListener(DataPacketType.BATTERY);
            this.log('Battery listener registered');
            this.registerDataListener(DataPacketType.HSI_PRECISION);
            this.log('HSI_PRECISION listener registered (signal quality)');
            
            this.log('Calling enableDataTransmission(true)...');
            this.connectedMuse.enableDataTransmission(true);
            this.log('enableDataTransmission(true) completed - NOW WAITING FOR DATA');
        } catch (err) {
            this.logError('ERROR in startStreaming():', err);
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
        return this.connectedMuse !== null && 
               this.connectedMuse.getConnectionState() === ConnectionState.CONNECTED;
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
        this.log('Data buffers - EEG:', this.dataBuffers.eeg.length, 'PPG:', this.dataBuffers.ppg.length, 'Accel:', this.dataBuffers.accelerometer.length);
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
            total: this.dataBuffers.eeg.length + this.dataBuffers.ppg.length + 
                   this.dataBuffers.accelerometer.length + this.dataBuffers.gyro.length + 
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
