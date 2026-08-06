import {
  contentAwareHeight,
  DOC_CELL_PAD,
  DOC_LABEL_GAP,
  DOC_SECTION_LABEL_SIZE,
  labeledBlockStackHeight,
  partyDisplayName,
} from './pdf-layout';

describe('pdf-layout height helpers', () => {
  it('contentAwareHeight keeps emptyMin only when content is blank', () => {
    expect(contentAwareHeight(0, 94)).toBe(94);
    expect(contentAwareHeight(40, 94)).toBe(40);
  });

  it('labeledBlockStackHeight matches pad + label + gap + value + pad', () => {
    const valueHeight = 48;
    expect(
      labeledBlockStackHeight(DOC_SECTION_LABEL_SIZE, valueHeight),
    ).toBe(
      DOC_CELL_PAD +
        DOC_SECTION_LABEL_SIZE +
        DOC_LABEL_GAP +
        valueHeight +
        DOC_CELL_PAD,
    );
  });

  it('taller measured value grows the stack so the next party block can sit below', () => {
    const short = labeledBlockStackHeight(DOC_SECTION_LABEL_SIZE, 20);
    const tall = labeledBlockStackHeight(DOC_SECTION_LABEL_SIZE, 72);
    expect(tall).toBeGreaterThan(short);
    expect(tall - short).toBe(52);
  });

  it('partyDisplayName keeps only the first non-empty line', () => {
    expect(
      partyDisplayName('SEATRANS QNH\n1 Harbor Rd\nTEL: 090  FAX: 028'),
    ).toBe('SEATRANS QNH');
    expect(partyDisplayName('  \n  Name Only  \n')).toBe('Name Only');
    expect(partyDisplayName(undefined)).toBe('');
  });
});
