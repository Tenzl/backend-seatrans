import { InquiryFieldChangeAction } from '../entities/inquiry-field-change-log.entity';
import { InquiryFieldChangeService } from './inquiry-field-change.service';

describe('InquiryFieldChangeService transaction repository', () => {
  it('writes audit rows through the supplied transaction manager', async () => {
    const defaultRepository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn(),
    };
    const transactionRepository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn(() => transactionRepository),
    };
    const service = new InquiryFieldChangeService(defaultRepository as never);

    await service.logFieldChanges(
      1,
      99,
      InquiryFieldChangeAction.EPDA_SAVE_DRAFT,
      [{ field: 'LOA', previousValue: '100', newValue: '101' }],
      manager as never,
    );

    expect(manager.getRepository).toHaveBeenCalledTimes(1);
    expect(transactionRepository.save).toHaveBeenCalledTimes(1);
    expect(defaultRepository.create).not.toHaveBeenCalled();
    expect(defaultRepository.save).not.toHaveBeenCalled();
  });
});
