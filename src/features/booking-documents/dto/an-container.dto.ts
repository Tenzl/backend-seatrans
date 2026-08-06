import { IsIn, IsOptional } from 'class-validator';
import { BOOKING_CARGO_VOLUME_TYPES } from '../cargo-volume';
import { PreviewText } from './preview-text.decorator';

const AN_CONTAINER_TYPES = ['', ...BOOKING_CARGO_VOLUME_TYPES] as const;

export class AnContainerDto {
  @IsOptional()
  @IsIn([...AN_CONTAINER_TYPES])
  type?: string;

  @PreviewText(200) containerNo?: string;
  @PreviewText(200) sealNo?: string;
  @PreviewText(200) grossWeight?: string;
  @PreviewText(200) measurement?: string;
  @PreviewText(200) tare?: string;
  @PreviewText(200) packageType?: string;
  @PreviewText(200) noOfPkgs?: string;
  @PreviewText(1_000) note?: string;
  @PreviewText(200) method?: string;
}
