import { BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createGlobalValidationPipe } from './global-validation';

class StrictRequestDto {
  @IsString()
  name!: string;
}

describe('global request validation', () => {
  it('rejects unknown properties with a stable field-level error', async () => {
    const pipe = createGlobalValidationPipe();

    await expect(
      pipe.transform(
        { name: 'Seatrans', injectedRole: 'ROLE_ADMIN' },
        { type: 'body', metatype: StrictRequestDto },
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Request validation failed',
        details: [
          {
            field: 'injectedRole',
            message: 'property injectedRole should not exist',
          },
        ],
      },
    } satisfies Partial<BadRequestException>);
  });
});
