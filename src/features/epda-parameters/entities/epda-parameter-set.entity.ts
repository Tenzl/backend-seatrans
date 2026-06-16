import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type EpdaParameterScope = 'AREA' | 'GROUP' | 'PORT';

/** A GRT-banded rate. `maxGrt: null` = the catch-all top band. */
export interface GrtTier {
  maxGrt: number | null;
  amount: number;
  label: string;
}

/** An LOA-banded rate (applies when `loa >= minLoa`, highest match wins). */
export interface LoaTier {
  minLoa: number;
  amount: number;
  label: string;
}

/** Agency fee on cargo (BB section) keyed by cargo type code, USD/MT. */
export interface CargoAgencyRate {
  /** Normalized cargo type code (e.g. IN_BULK, EQUIPMENT). */
  code: string;
  label: string;
  rate: number;
}

/** @deprecated use GrtTier. */
export type AgencyFeeTier = GrtTier;

export interface EpdaParameterValues {
  hours: {
    berthHours: number;
    anchorageHours: number;
    pilotageThirdMiles: number; // HCM template
    qnPilotageMiles: number; // QN template
  };
  garbage: {
    atBerthUsd: number;
    atBuoyUsd: number;
    cbmAmount: number;
  };
  quarantine: {
    shipUnitLowGrt: number;
    shipUnitHighGrt: number;
    shipThresholdGrt: number;
    cargoPerTrip: number;
  };
  coeff: {
    tonnagePerGrt: number;
    navigationPerGrt: number;
    tankerFactor: number;
    bulkFactor: number;
    berthDuePerGrtHour: number;
    buoyDuePerGrtHour: number;
    anchoragePerGrtHour: number;
    clearanceFee: number;
    oceanFrtDefaultRate: number;
    oceanFrtTaxRate: number;
    pilotageLeg1Rate: number;
    pilotageLeg1Miles: number;
    pilotageLeg2Rate: number;
    pilotageLeg2Miles: number;
    pilotageLeg3Rate: number;
    pilotageSingleRate: number;
    pilotageMinAmount: number;
    cargoAgencyBagRate: number;
    cargoAgencyEquipRate: number;
    cargoAgencyBulkRate: number;
  };
  agencyFeeTiers: GrtTier[];
  moorUnmoorBerthTiers: GrtTier[];
  moorUnmoorBuoyTiers: GrtTier[];
  tugTiers: LoaTier[];
  /** Per-cargo-type agency fee on cargo. Falls back to coeff bag/equip/bulk rates. */
  cargoAgencyRates: CargoAgencyRate[];
}

/** Deeply-partial values — used for port overrides and incoming upsert payloads. */
export type PartialEpdaParameterValues = {
  hours?: Partial<EpdaParameterValues['hours']>;
  garbage?: Partial<EpdaParameterValues['garbage']>;
  quarantine?: Partial<EpdaParameterValues['quarantine']>;
  coeff?: Partial<EpdaParameterValues['coeff']>;
  agencyFeeTiers?: GrtTier[];
  moorUnmoorBerthTiers?: GrtTier[];
  moorUnmoorBuoyTiers?: GrtTier[];
  tugTiers?: LoaTier[];
  cargoAgencyRates?: CargoAgencyRate[];
};

/**
 * EPDA numeric parameters, scoped per area (full set), per group (named set of
 * ports inside an area), or per port (partial override). Resolution layers
 * area → group → port (later wins). Stored as JSONB for flexibility.
 */
@Entity('epda_parameter_set')
@Index('uq_epda_param_area', ['area'], { unique: true, where: "scope = 'AREA'" })
@Index('uq_epda_param_port', ['portId'], { unique: true, where: "scope = 'PORT'" })
@Index('uq_epda_param_group', ['area', 'name'], { unique: true, where: "scope = 'GROUP'" })
export class EpdaParameterSet {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 10 })
  scope!: EpdaParameterScope;

  /** Area for AREA rows; owning area for GROUP/PORT rows (for grouping/fallback). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  area!: string | null;

  @Column({ name: 'port_id', type: 'int', nullable: true })
  portId!: number | null;

  /** Group display name (GROUP rows only). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  name!: string | null;

  /** Port ids that belong to this group (GROUP rows only). A port is in ≤ 1 group/area. */
  @Column({ name: 'member_port_ids', type: 'jsonb', nullable: true })
  memberPortIds!: number[] | null;

  /** Full set for AREA rows; partial (only overridden fields) for GROUP/PORT rows. */
  @Column({ type: 'jsonb' })
  values!: PartialEpdaParameterValues;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
