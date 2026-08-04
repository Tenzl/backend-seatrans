import { mkdirSync, writeFileSync } from 'node:fs'
import { BookingDocumentPdfRenderer } from '../dist/features/booking-documents/rendering/booking-document-pdf.renderer.js'

const renderer = new BookingDocumentPdfRenderer()
const payload = {
  fblNumber: 'STVN-260607',
  consignor:
    'AN THINH STONE CO., LTD\n92 HAI BA TRUNG STREET, QUY NHON WARD, GIA LAI PROVINCE, VIETNAM\nTEL: +84-256-3 701 745 / FAX: +84-256-3 733 255',
  consignedToOrderOf:
    'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN\n+81-584-43-5974',
  notifyAddress:
    'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN\n+81-584-43-5974',
  placeOfReceipt: 'QUI NHON, VN (VNUIH)',
  oceanVessel: 'SITC MINHE',
  voyageNumber: '2615N',
  portOfLoading: 'DA NANG, VN (VNDAD)',
  portOfDischarge: 'HAKATA, FUKUOKA, JP (JPHKT)',
  placeOfDelivery: 'HAKATA, FUKUOKA, JP (JPHKT)',
  marksAndNumbers: "FCL/FCL - CY/CY\nSITU2631620/ SITR892044/ 20'DC\nN/M",
  numberAndKindOfPackages: "20 PALLET(S)",
  descriptionOfGoods:
    "AT SHIPPER'S LOAD, COUNT, STOW & SEAL\nSAID TO CONTAIN: ONE CONTAINER(S) ONLY\n1x20'DC\nGRANITE STONES, BASALT STONES\nHS CODE: 68010000",
  grossWeight: '20,700 KGS',
  measurement: '7.26 CBM',
  freightTerms: 'FREIGHT COLLECT',
  cleanOnBoard: 'CLEAN ON BOARD Jun 14, 2026',
  declarationOfInterest: '',
  declaredValue: '',
  freightAmount: 'AS ARRANGED',
  freightPayableAt: 'HAKATA, FUKUOKA, JP (JPHKT)',
  placeOfIssue: 'DA NANG, VN (VNDAD)',
  dateOfIssue: 'Jun 14, 2026',
  numberOfOriginals: 'THREE/3',
  cargoInsurance: 'not_covered',
  deliveryApplyTo:
    'APEX INTERNATIONAL INC.\n7F, TOYOKUNI BLDG, 2-4-6, SHIBA-DAIMON, MINATO-KU, TOKYO 105-0012 JAPAN\nTEL: 81-3-5408-3733 FAX: 81-3-5408-3589',
  blFormVariant: 'surrendered',
}

const preview = await renderer.render('bl', payload)
mkdirSync('_bl_verify', { recursive: true })
writeFileSync('_bl_verify/sample-filled.pdf', preview.data)
console.log('wrote', preview.filename, preview.data.length)
