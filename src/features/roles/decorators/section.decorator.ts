import { SetMetadata } from '@nestjs/common';

export const SECTION_KEY = 'section';

/** Tags a controller/handler with the dashboard section it belongs to. */
export const Section = (section: string) => SetMetadata(SECTION_KEY, section);
