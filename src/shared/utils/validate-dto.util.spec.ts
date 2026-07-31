import { IsString } from 'class-validator';
import { validateDto } from './validate-dto.util';

class StrictExampleDto {
  @IsString()
  name!: string;
}

describe('validateDto strict contract', () => {
  it('rejects unknown properties instead of silently discarding them', async () => {
    await expect(
      validateDto(StrictExampleDto, {
        name: 'Seatrans',
        injectedRole: 'ROLE_ADMIN',
      }),
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
    });
  });
});
