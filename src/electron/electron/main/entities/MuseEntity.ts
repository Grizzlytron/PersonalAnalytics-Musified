import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'muse_data' })
@Index(['timestamp'])
@Index(['deviceId'])
@Index(['timestamp', 'deviceId'])
export class MuseEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column('text', { nullable: false })
  deviceId: string;

  @Column('text', { nullable: false })
  deviceName: string;

  @Column('datetime', { nullable: false })
  timestamp: Date;

  // EEG channel data (4 channels from Muse S headband) - averaged microvolts
  @Column('float', { nullable: true })
  channel1_TP9: number; // Left ear (TP9)

  @Column('float', { nullable: true })
  channel2_AF7: number; // Left forehead (AF7)

  @Column('float', { nullable: true })
  channel3_AF8: number; // Right forehead (AF8)

  @Column('float', { nullable: true })
  channel4_TP10: number; // Right ear (TP10)

  // PPG/Optics data (heart rate sensor)
  @Column('float', { nullable: true })
  ppg: number;

  // Battery level (0-100 percent)
  @Column('int', { nullable: true, default: 0 })
  batteryLevel: number;

  // Signal quality (1-4: 1=good, 2=ok, 4=poor fit) - instant worst-channel value
  @Column('int', { nullable: true, default: 0 })
  signalQuality: number;

  // Connection state with Muse device
  @Column('text', { nullable: true, default: 'unknown' })
  connectionState: string;

  // ========== BAND POWERS - RELATIVE (0-1, best for ML) ==========
  // Averaged across 4 EEG channels over collection interval
  
  @Column('float', { nullable: true })
  alphaRelative: number; // 7.5-13 Hz - Relaxation, idle state

  @Column('float', { nullable: true })
  betaRelative: number; // 13-30 Hz - Focus, active thinking

  @Column('float', { nullable: true })
  deltaRelative: number; // 1-4 Hz - Deep sleep

  @Column('float', { nullable: true })
  thetaRelative: number; // 4-8 Hz - Drowsiness, meditation

  @Column('float', { nullable: true })
  gammaRelative: number; // 30+ Hz - High-level cognition

  // ========== BAND POWERS - ABSOLUTE (in Bels) ==========
  
  @Column('float', { nullable: true })
  alphaAbsolute: number;

  @Column('float', { nullable: true })
  betaAbsolute: number;

  @Column('float', { nullable: true })
  deltaAbsolute: number;

  @Column('float', { nullable: true })
  thetaAbsolute: number;

  @Column('float', { nullable: true })
  gammaAbsolute: number;

  // ========== BAND POWER SCORES (0-1, percentile-based) ==========
  
  @Column('float', { nullable: true })
  alphaScore: number;

  @Column('float', { nullable: true })
  betaScore: number;

  @Column('float', { nullable: true })
  deltaScore: number;

  @Column('float', { nullable: true })
  thetaScore: number;

  @Column('float', { nullable: true })
  gammaScore: number;

  // ========== QUALITY INDICATORS ==========
  
  @Column('float', { nullable: true })
  isGood: number; // Data quality indicator (averaged)

  @Column('float', { nullable: true })
  varianceEeg: number; // EEG signal variance

  @Column('float', { nullable: true })
  heartRate: number; // Calculated from optics/PPG (BPM)

  // ========== MOVEMENT SENSORS ==========
  
  @Column('float', { nullable: true })
  accelerometerAvg: number; // Averaged 3-axis magnitude

  @Column('float', { nullable: true })
  gyroAvg: number; // Averaged 3-axis magnitude

  // Additional metadata or auxiliary data
  @Column('text', { nullable: true })
  additionalData: string;
}
