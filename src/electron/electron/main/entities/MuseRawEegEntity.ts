import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'muse_raw_eeg' })
@Index(['timestamp'])
export class MuseRawEegEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('datetime', { nullable: false })
  timestamp: Date;

  @Column('float', { nullable: false })
  tp9: number;

  @Column('float', { nullable: false })
  af7: number;

  @Column('float', { nullable: false })
  af8: number;

  @Column('float', { nullable: false })
  tp10: number;
}
