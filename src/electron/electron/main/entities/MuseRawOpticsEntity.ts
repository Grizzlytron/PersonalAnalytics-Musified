import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'muse_raw_optics' })
@Index(['timestamp'])
export class MuseRawOpticsEntity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('datetime', { nullable: false })
  timestamp!: Date;

  @Column('float', { nullable: false })
  ch0!: number;

  @Column('float', { nullable: false })
  ch1!: number;

  @Column('float', { nullable: false })
  ch2!: number;

  @Column('float', { nullable: false })
  ch3!: number;
}
