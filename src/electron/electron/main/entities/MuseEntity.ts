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

  // EEG channel data (4 channels from Muse S headband)
  @Column('float', { nullable: true })
  channel1_TP9: number; // Left ear (TP9)

  @Column('float', { nullable: true })
  channel2_AF7: number; // Left forehead (AF7)

  @Column('float', { nullable: true })
  channel3_AF8: number; // Right forehead (AF8)

  @Column('float', { nullable: true })
  channel4_TP10: number; // Right ear (TP10)

  // PPG (Photoplethysmography - heart rate data)
  @Column('float', { nullable: true })
  ppg: number;

  // Battery level (0-100 percent)
  @Column('int', { nullable: true, default: 0 })
  batteryLevel: number;

  // Signal quality (0-4, where 4 is best)
  @Column('int', { nullable: true, default: 0 })
  signalQuality: number;

  // Connection state with Muse device
  @Column('text', { nullable: true, default: 'unknown' })
  connectionState: string;

  // Additional metadata or auxiliary data
  @Column('text', { nullable: true })
  additionalData: string;
}
