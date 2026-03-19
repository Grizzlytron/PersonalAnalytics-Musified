import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'muse_metadata' })
@Index(['timestamp'])
export class MuseMetadataEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('datetime', { nullable: false })
  timestamp: Date;

  // Battery level (0-100)
  @Column('int', { nullable: true })
  batteryLevel: number | null;

  // HSI per channel (1=good, 2=mediocre, 4=poor)
  @Column('int', { nullable: true })
  hsiTp9: number | null;

  @Column('int', { nullable: true })
  hsiAf7: number | null;

  @Column('int', { nullable: true })
  hsiAf8: number | null;

  @Column('int', { nullable: true })
  hsiTp10: number | null;

  // Overall quality (worst HSI channel)
  @Column('int', { nullable: true })
  signalQuality: number | null;
}
