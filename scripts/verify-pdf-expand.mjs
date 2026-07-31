import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(join(root, 'package.json'));

const rendererPath = join(
  root,
  'dist/features/booking-documents/rendering/booking-document-pdf.renderer.js',
);
const typePath = join(
  root,
  'dist/features/booking-documents/enums/booking-document-type.enum.js',
);

if (!existsSync(rendererPath)) {
  console.error('Missing build output. Run: npm run build');
  process.exit(1);
}

const { BookingDocumentPdfRenderer } = require(rendererPath);
const { BookingDocumentType } = require(typePath);
const { PDFDocument } = require('pdf-lib');

const longPara = (n) =>
  Array.from(
    { length: n },
    (_, i) =>
      `Line ${i + 1}: Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.`,
  ).join('\n');

const longCargo = (desc) => ({
  containerSealNumber: 'MSCU1234567 / ML-998877',
  quantity: '1x40HC',
  descriptionOfGoods: desc,
  grossWeight: '18,500.00 KGS',
  measurement: '67.890 CBM',
});

const renderer = new BookingDocumentPdfRenderer();
const outDir = join(root, '_pdf_expand_verify');
mkdirSync(outDir, { recursive: true });

const samples = [
  [
    'an-short',
    BookingDocumentType.ARRIVAL_NOTICE,
    {
      agent: 'SEATRANS QNH',
      date: '31/07/2026',
      anNumber: 'AN-001',
      shipper: 'Short Shipper Co',
      consignee: 'Short Consignee',
      notifyParty: 'Notify A',
      mblNumber: 'MBL1',
      hblNumber: 'HBL1',
      marks: 'N/M',
      volume: '1x40',
      note: 'OK',
      customerAttention: 'Please collect docs.',
      cargoRows: [longCargo('General cargo')],
    },
  ],
  [
    'an-long',
    BookingDocumentType.ARRIVAL_NOTICE,
    {
      agent: 'SEATRANS QNH',
      date: '31/07/2026',
      anNumber: 'AN-LONG',
      shipper: longPara(12),
      consignee: longPara(10),
      notifyParty: longPara(8),
      mblNumber: 'MBL-LONG',
      hblNumber: 'HBL-LONG',
      vesselVoyage: 'VESSEL LONG / V001',
      etdEta: '01/08 - 10/08',
      marks: longPara(6),
      volume: '2x40HC + 1x20GP special equipment notes',
      note: longPara(7),
      customerAttention: longPara(5),
      cargoRows: [
        longCargo(longPara(4)),
        longCargo(longPara(3)),
        longCargo('Short'),
        longCargo(longPara(5)),
        longCargo('Overflow row 5'),
        longCargo('Overflow row 6'),
      ],
    },
  ],
  [
    'do-short',
    BookingDocumentType.DELIVERY_ORDER,
    {
      doNumber: 'DO-001',
      date: '31/07/2026',
      to: 'CFS Terminal',
      deliverTo: 'Receiver Co',
      notifyParty: 'Notify',
      marks: 'N/M',
      volume: '1x20',
      note: 'OK',
      customerAttention: 'Attention note',
      cargoRows: [longCargo('General cargo')],
    },
  ],
  [
    'do-long',
    BookingDocumentType.DELIVERY_ORDER,
    {
      doNumber: 'DO-LONG',
      date: '31/07/2026',
      to: longPara(4),
      deliverTo: longPara(5),
      notifyParty: longPara(8),
      marks: longPara(5),
      volume: longPara(3),
      note: longPara(6),
      customerAttention: longPara(4),
      cargoRows: [
        longCargo(longPara(4)),
        longCargo(longPara(3)),
        longCargo(longPara(2)),
        longCargo(longPara(5)),
        longCargo('Overflow'),
      ],
    },
  ],
  [
    'an-long-cargo',
    BookingDocumentType.ARRIVAL_NOTICE,
    {
      agent: 'SEATRANS QNH',
      date: '31/07/2026',
      anNumber: 'AN-CARGO',
      shipper: 'Shipper Co Ltd',
      consignee: 'Consignee Co Ltd',
      notifyParty: 'Notify Party',
      marks: 'MARKS-001\nMARKS-002\nMARKS-003\nMARKS-004',
      volume: '2x40HC',
      note: 'Handle with care. Stack not over 2 high.',
      customerAttention: 'Please contact ops before pickup.',
      cargoRows: [
        longCargo(longPara(5)),
        longCargo(longPara(4)),
        longCargo('Short description'),
        longCargo(longPara(6)),
        longCargo('Overflow row'),
      ],
    },
  ],
  [
    'do-long-cargo',
    BookingDocumentType.DELIVERY_ORDER,
    {
      doNumber: 'DO-CARGO',
      date: '31/07/2026',
      to: 'CFS Terminal',
      deliverTo: 'Receiver Warehouse',
      notifyParty: 'Notify Party',
      marks: 'MARKS-A\nMARKS-B\nMARKS-C',
      volume: '1x40HC',
      note: 'Bonded delivery',
      customerAttention: 'Bring ID and DO original.',
      cargoRows: [
        longCargo(longPara(5)),
        longCargo(longPara(3)),
        longCargo(longPara(4)),
        longCargo(longPara(2)),
        longCargo('Overflow'),
      ],
    },
  ],
];

for (const [name, type, payload] of samples) {
  const preview = await renderer.render(type, payload);
  const file = join(outDir, `${name}.pdf`);
  writeFileSync(file, preview.data);
  const pdf = await PDFDocument.load(preview.data);
  const pages = pdf.getPageCount();
  const raw = Buffer.from(preview.data).toString('latin1');
  const suspiciousEllipsis = raw.includes('\u2026');
  console.log(
    `${name}: pages=${pages} bytes=${preview.data.length} ellipsis=${suspiciousEllipsis} -> ${file}`,
  );
}

console.log('verify-pdf-expand done');
