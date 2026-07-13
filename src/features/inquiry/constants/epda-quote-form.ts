export const EPDA_QUOTE_FORMS = ['HCM', 'HN', 'QN'] as const;

export type EpdaQuoteForm = (typeof EPDA_QUOTE_FORMS)[number];

export const EPDA_QUOTE_FORM_BY_AREA = {
  '1': 'HN',
  '2': 'QN',
  '3': 'HCM',
} as const satisfies Record<string, EpdaQuoteForm>;
