# Shipping Agency EPDA (backend2.0)

## Data model

All inquiries use `shipping_agency_inquiries`. Internal EPDA fields are **columns on the same row** (not a separate table). Customer APIs never return internal pricing fields.

| Column | Visibility |
|--------|------------|
| `shipowner_to`, cargo, port, … | Customer + admin |
| `epda_document_date`, `agency_fee_mode`, `epda_snapshot`, … | Admin only |
| `quoted_at`, `quoted_by_user_id` | Admin only; customers see `quoteAvailable: true` |

Run migration: `docs/sql/2026-05-27_shipping_agency_inquiries_epda_internal_fields_postgres.sql`

## Workflow

1. **Customer** — `POST /api/v1/inquiries` (unchanged). `created_source = CUSTOMER_PORTAL`.
2. **Internal** — `PATCH .../shipping-agency/:id/epda` to adjust draft fields.
3. **Issue** — `POST .../shipping-agency/:id/epda/issue` with `epdaSnapshot` → `status = QUOTED`.
4. **PDF** — Upload via `POST /api/v1/admin/inquiries/shipping-agency/:id/documents` (`documentType=INVOICE`). Customer downloads when quoted.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/admin/users/external-customers?q=&limit=` | Admin / Employee / Internal |
| POST | `/api/v1/admin/users/external-customers` `{ "fullName": "..." }` | Admin / Employee / Internal |
| POST | `/api/v1/admin/inquiries/shipping-agency` | Admin / Employee / Internal |
| PATCH | `/api/v1/admin/inquiries/shipping-agency/:id/epda` | Admin / Employee / Internal |
| POST | `/api/v1/admin/inquiries/shipping-agency/:id/epda/issue` | Admin / Employee / Internal |

**External customers (Create EPDA):** List returns users whose role has `role_group = EXTERNAL`. Creating a customer sets `role_id` from `EXTERNAL_CUSTOMER_ROLE_ID` (default `4`), `full_name` from the request, `created_by_user_id` to the authenticated staff user, and a unique placeholder `email` under `EXTERNAL_CUSTOMER_PLACEHOLDER_EMAIL_DOMAIN` (default `customers.seatrans.local`). Migration: `docs/sql/2026-05-28_users_created_by_user_id_postgres.sql`.

## Security

- `@ApiAdmin()` on all routes above.
- `GET /api/v1/inquiries/user/:userId` strips internal EPDA fields via `mapShippingAgencyInquiryFields(..., 'user')`.
- `epdaSnapshot` max 256 KB JSON; validated on write.
- Public submit DTO has no EPDA fields — clients cannot set internal columns through portal.
