import { BadRequestException } from '@nestjs/common';
import {
  assertInquiryAttachmentSafe,
  inquiryAttachmentFileFilter,
} from './inquiry-file-validation';

function multerFile(
  partial: Partial<Express.Multer.File> & { originalname: string },
): Express.Multer.File {
  return {
    fieldname: 'files',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: partial.buffer?.length ?? 0,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    buffer: Buffer.alloc(0),
    ...partial,
  } as Express.Multer.File;
}

describe('inquiry file validation (SEC-03)', () => {
  it('rejects attachments whose magic bytes do not match an allowed type', async () => {
    const htmlDisguisedAsPdf = multerFile({
      originalname: 'invoice.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('<!DOCTYPE html><html><script>alert(1)</script>'),
    });

    await expect(assertInquiryAttachmentSafe(htmlDisguisedAsPdf)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(assertInquiryAttachmentSafe(htmlDisguisedAsPdf)).rejects.toThrow(
      /does not match an allowed type/i,
    );
  });

  it('rejects when extension and magic bytes disagree', async () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const spoofed = multerFile({
      originalname: 'photo.pdf',
      mimetype: 'application/pdf',
      buffer: jpegBytes,
    });

    await expect(assertInquiryAttachmentSafe(spoofed)).rejects.toThrow(
      /extension does not match file content/i,
    );
  });

  it('accepts a real PDF header and returns canonical mime (ignores client mime)', async () => {
    const pdf = multerFile({
      originalname: 'cargo.PDF',
      mimetype: 'application/x-msdownload',
      buffer: Buffer.from('%PDF-1.7\n%âãÏÓ\n'),
    });

    await expect(assertInquiryAttachmentSafe(pdf)).resolves.toEqual({
      extension: '.pdf',
      mimeType: 'application/pdf',
      kind: 'pdf',
    });
  });

  it('fileFilter rejects disallowed extensions before buffering content', () => {
    const cb = jest.fn();
    inquiryAttachmentFileFilter(
      {},
      multerFile({ originalname: 'payload.exe', mimetype: 'application/pdf' }),
      cb,
    );
    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });
});
