# Shipping Agency EPDA (backend2.0)

## Data model

All inquiries use `shipping_agency_inquiries`. Internal EPDA fields are **columns on the same row** (not a separate table). Customer APIs never return internal pricing fields.

| Column | Visibility |
|--------|------------|
| `shipowner_to`, cargo, port, … | Customer + admin |
| `epda_document_date`, `agency_fee_mode`, `agency_other_expenses`, `epda_snapshot`, … | Admin only |
| `quoted_at`, `quoted_by_user_id` | Admin only; customers see `quoteAvailable: true` |

Admin responses expose `employeeInCharge` from `processed_by`. They expose
`clientSubmittedBy` from `user_id` only for `CUSTOMER_PORTAL` records; an
`INTERNAL_EPDA` created by staff always returns `clientSubmittedBy: null`.

Run migration: `docs/sql/2026-05-27_shipping_agency_inquiries_epda_internal_fields_postgres.sql`

`agency_other_expenses` (JSONB, optional): array of `{ "name": string, "amount": number }` for custom fee lines under agency **in lumpsum** mode. Cleared when fee mode is not `LUMPSUM`. Migration: `docs/sql/2026-08-07_agency_other_expenses_postgres.sql`.

## Workflow

1. **Customer** — `POST /api/v1/inquiries` (unchanged). `created_source = CUSTOMER_PORTAL`.
2. **Internal** — `PATCH .../shipping-agency/:id/epda` to adjust draft fields (status PROCESSING/COMPLETED from completeness).
3. **Lock** — `POST .../shipping-agency/:id/epda/lock` with `epdaSnapshot` freezes tariff rates (does not change status).
4. **PDF** — Upload via `POST /api/v1/admin/inquiries/shipping-agency/:id/documents` (`documentType=INVOICE`).

> Note: the former `POST .../epda/issue` (“Issue to customer” → `QUOTED`) endpoint was removed.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/admin/inquiries/shipping-agency` | Admin / Employee / Internal |
| PATCH | `/api/v1/admin/inquiries/shipping-agency/:id/epda` | Admin / Employee / Internal |
| POST | `/api/v1/admin/inquiries/shipping-agency/:id/epda/lock` | Admin / Employee / Internal |

**Create EPDA:** ownership is derived from the authenticated staff user. The
request does not accept a client/owner user id.

## Security

- `@ApiAdmin()` on all routes above.
- `GET /api/v1/inquiries/user/:userId` strips internal EPDA fields via `mapShippingAgencyInquiryFields(..., 'user')`.
- `epdaSnapshot` max 256 KB JSON; validated on write.
- Public submit DTO has no EPDA fields — clients cannot set internal columns through portal.
