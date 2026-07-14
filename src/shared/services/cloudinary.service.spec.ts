import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      destroy: jest.fn(),
    },
  },
}));

describe('CloudinaryService deletion', () => {
  const destroy = cloudinary.uploader.destroy as jest.Mock;

  beforeEach(() => {
    destroy.mockReset().mockResolvedValue({ result: 'ok' });
  });

  function createService() {
    return new CloudinaryService({
      get: jest.fn(),
    } as unknown as ConfigService);
  }

  it('deletes image uploads with the image resource type by default', async () => {
    await createService().deleteByPublicId('gallery/example');

    expect(destroy).toHaveBeenCalledWith('gallery/example', {
      resource_type: 'image',
    });
  });

  it('deletes inquiry documents with the raw resource type', async () => {
    await createService().deleteByPublicId('inquiries/example.pdf', 'raw');

    expect(destroy).toHaveBeenCalledWith('inquiries/example.pdf', {
      resource_type: 'raw',
    });
  });
});
