import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { EpdaParameterSet } from './entities/epda-parameter-set.entity';

export class EpdaParameterVersionControl {
  private readonly logger: Logger;
  private readonly requireExpectedVersion: boolean;

  constructor(loggerContext = EpdaParameterVersionControl.name) {
    this.logger = new Logger(loggerContext);
    const configured =
      process.env.EPDA_REQUIRE_EXPECTED_VERSION?.trim().toLowerCase();
    // The dashboard now sends versions consistently. Production cannot reopen
    // the legacy last-write-wins window, even if an old env value says false.
    this.requireExpectedVersion =
      configured === 'true' || process.env.NODE_ENV === 'production';
  }

  assertExpectedVersion(
    current: EpdaParameterSet,
    expectedVersion: number | null | undefined,
    resource: string,
  ): void {
    const currentVersion = current.version ?? 1;
    if (expectedVersion === undefined) {
      if (this.requireExpectedVersion) {
        throw new HttpException(
          {
            code: 'EPDA_PARAMETER_VERSION_REQUIRED',
            message: `${resource} requires expectedVersion`,
          },
          HttpStatus.PRECONDITION_REQUIRED,
        );
      }
      this.logger.warn(
        `${resource} was mutated without expectedVersion; legacy compatibility is temporary`,
      );
      return;
    }
    if (expectedVersion === null || expectedVersion !== currentVersion) {
      throw new ConflictException({
        code: 'EPDA_PARAMETER_VERSION_CONFLICT',
        message: `${resource} has changed; reload before saving`,
        currentVersion,
      });
    }
  }

  createAfterVersionCheck(
    repository: Repository<EpdaParameterSet>,
    values: Partial<EpdaParameterSet>,
    expectedVersion: number | null | undefined,
    resource: string,
  ): EpdaParameterSet {
    if (expectedVersion != null) {
      throw new ConflictException({
        code: 'EPDA_PARAMETER_VERSION_CONFLICT',
        message: `${resource} no longer matches the requested version`,
        currentVersion: null,
      });
    }
    if (expectedVersion === undefined) {
      if (this.requireExpectedVersion) {
        throw new HttpException(
          {
            code: 'EPDA_PARAMETER_VERSION_REQUIRED',
            message: `${resource} requires expectedVersion`,
          },
          HttpStatus.PRECONDITION_REQUIRED,
        );
      }
      this.logger.warn(
        `${resource} was created without expectedVersion; legacy compatibility is temporary`,
      );
    }
    return repository.create({ ...values, version: 1 });
  }

  async updateWithVersion(
    repository: Repository<EpdaParameterSet>,
    current: EpdaParameterSet,
    patch: Partial<EpdaParameterSet>,
    expectedVersion: number | null | undefined,
    resource: string,
  ): Promise<EpdaParameterSet> {
    this.assertExpectedVersion(current, expectedVersion, resource);
    const currentVersion = current.version ?? 1;
    const result = await repository.update(
      { id: current.id, scope: current.scope, version: currentVersion },
      patch,
    );
    if (result.affected !== 1) {
      await this.throwVersionConflict(
        repository,
        current.id,
        current.portId ?? undefined,
      );
    }
    const saved = await repository.findOne({
      where: { id: current.id, scope: current.scope },
    });
    if (!saved) throw new NotFoundException(`${resource} not found`);
    return saved;
  }

  async throwVersionConflict(
    repository: Repository<EpdaParameterSet>,
    id: number,
    portId?: number,
  ): Promise<never> {
    const current = await repository.findOne({
      where: portId ? { scope: 'PORT', portId } : { id },
    });
    throw new ConflictException({
      code: 'EPDA_PARAMETER_VERSION_CONFLICT',
      message: 'EPDA parameters changed; reload before saving',
      currentVersion: current?.version ?? null,
    });
  }
}
