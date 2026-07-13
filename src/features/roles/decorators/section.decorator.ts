import { SetMetadata } from '@nestjs/common';

export const SECTION_KEY = 'section';

/** Explicit skip token — method-level override that bypasses section ACL. */
export const SECTION_CHECK_SKIP = '__section_check_skip__';

/**
 * Tags a controller/handler with one or more dashboard sections.
 * Access is granted if the user can access ANY of the listed sections.
 */
export const Section = (...sections: string[]) =>
  SetMetadata(SECTION_KEY, sections);

/** Skip section ACL on a handler (JWT + role guards still apply). */
export const SkipSectionCheck = () =>
  SetMetadata(SECTION_KEY, SECTION_CHECK_SKIP);
