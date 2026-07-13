import { ArgumentMetadata, ParseIntPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { EpdaParametersAdminController } from './epda-parameters-admin.controller';

type RouteArgument = { index: number; pipes: unknown[] };

function numericPipe(method: string, index: number): ParseIntPipe {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    EpdaParametersAdminController,
    method,
  ) as Record<string, RouteArgument>;
  const argument = Object.values(metadata).find(
    (entry) => entry.index === index,
  );
  const pipe = argument?.pipes.find(
    (candidate) => candidate instanceof ParseIntPipe,
  );
  if (!(pipe instanceof ParseIntPipe)) {
    throw new Error(`${method} argument ${index} has no ParseIntPipe`);
  }
  return pipe;
}

describe('EpdaParametersAdminController numeric parsing', () => {
  const metadata: ArgumentMetadata = { type: 'param', data: 'id' };

  it.each([
    ['getPort', 0],
    ['upsertPort', 0],
    ['deletePort', 0],
    ['updateGroup', 0],
    ['setGroupMembers', 0],
    ['deleteGroup', 0],
    ['getEffective', 1],
    ['listChangeLogs', 1],
    ['listChangeLogs', 2],
  ])('rejects NaN for %s argument %i', async (method, index) => {
    await expect(
      numericPipe(method, index).transform('not-a-number', metadata),
    ).rejects.toBeDefined();
  });

  it('allows omitted optional numeric query values', async () => {
    const queryMetadata: ArgumentMetadata = { type: 'query', data: 'portId' };
    await expect(
      numericPipe('getEffective', 1).transform(
        undefined as unknown as string,
        queryMetadata,
      ),
    ).resolves.toBeUndefined();
  });
});
