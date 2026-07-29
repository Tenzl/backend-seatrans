import { PreviewText } from './preview-text.decorator';

export class CargoRowDto {
  @PreviewText(300)
  containerSealNumber?: string;

  @PreviewText(200)
  quantity?: string;

  @PreviewText(1_000)
  descriptionOfGoods?: string;

  @PreviewText(200)
  grossWeight?: string;

  @PreviewText(200)
  measurement?: string;
}
