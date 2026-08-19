# API conventions (`backend2.0`)

REST resources under `/api/v1/...` with envelope `{ success, message, data }`.

## Errors

```json
{
  "success": false,
  "message": "Request validation failed",
  "data": null,
  "error": {
    "code": "validation_error",
    "message": "...",
    "details": [{ "field": "serviceTypeSlug", "message": "..." }]
  }
}
```

## Pagination

`GET` list endpoints use `page` (0-based), `size` (max 100). Response in `data`:

```json
{
  "content": [],
  "page": 0,
  "size": 20,
  "totalElements": 0,
  "totalPages": 0,
  "last": true,
  "hasNext": false,
  "pageable": { "pageNumber": 0, "pageSize": 20 }
}
```

## Search

Use query param `q` on collection GET routes (not `/search` path segments).

## Admin auth

`@ApiAdmin()` = JWT + `ROLE_ADMIN` | `ROLE_EMPLOYEE` | `ROLE_INTERNAL`.

## Shipping EPDA field visibility

- Customer list/detail (`GET /v1/inquiries/user/:userId`): no internal EPDA columns; `quoteAvailable` when `QUOTED`.
- Admin list/detail: full EPDA fields. See `docs/SHIPPING_AGENCY_EPDA.md`.

## Canonical routes

| Area                     | Endpoints                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Gallery public           | `GET /v1/gallery/images`                                                              |
| Gallery admin            | `POST /v1/admin/gallery-images/batch`, `POST .../from-url`, `GET ...?unpaged=true`    |
| Commodity Types admin    | `GET\|POST /v1/admin/commodity-types`, `PATCH\|DELETE /v1/admin/commodity-types/:id`  |
| Commodities admin        | `GET\|POST /v1/admin/commodities`, `GET\|PUT\|DELETE /v1/admin/commodities/:id`       |
| Posts public             | `GET /v1/posts?page=&size=&q=&category=`, `GET /v1/posts/latest`                      |
| Provinces / ports read   | `GET /v1/provinces`, `GET /v1/ports?page=&size=` (max 100), `?q=&searchIn=`           |
| Provinces / ports write  | `POST                                                                                 | PUT                                             | DELETE /v1/admin/provinces`, `/v1/admin/ports` |
| Inquiry submit           | `POST /v1/inquiries` — requires `serviceTypeId` **or** `serviceTypeSlug`              |
| Inquiry admin list       | `GET /v1/admin/inquiries?serviceSlug=&status=&page=&size=`                            |
| Inquiry admin detail     | `GET /v1/admin/inquiries/:serviceType/:id`                                            |
| Shipping EPDA (internal) | `POST /v1/admin/inquiries/shipping-agency` (create with EPDA draft)                   |
| Shipping EPDA draft      | `PATCH /v1/admin/inquiries/shipping-agency/:id/epda`                                  |
| Shipping EPDA lock       | `POST /v1/admin/inquiries/shipping-agency/:id/epda/lock`                              |
| Inquiry documents admin  | `POST                                                                                 | DELETE /v1/admin/inquiries/:slug/:id/documents` |
| Inquiry document file    | `GET /v1/inquiries/:slug/:id/documents/:docId/content?disposition=inline\|attachment` |

## HTTP status

| Action        | Status |
| ------------- | ------ |
| POST create   | 201    |
| DELETE        | 204    |
| GET/PATCH/PUT | 200    |

## Utilities

- `shared/utils/validate-dto.util.ts` — validate parsed JSON/multipart bodies
- `shared/dto/pagination.dto.ts` — `buildPaginatedResponse()`
- `shared/validators/require-one-of.validator.ts` — class-level constraints

## Special cases

- Document `content` endpoints use `@Res()` redirect (302) — no JSON envelope on success
- Commodity Type and Commodity are independent Service-scoped catalogs. See
  `docs/commodity-catalog.md` for snapshot and migration behavior.
- Commodity Type create/update/list contracts are code-free. The public Type
  shape is `{ id, serviceTypeId, name, createdAt, updatedAt }`; legacy `code`
  input is rejected by DTO validation.
- EPDA `cargoAgencyRates` writes use
  `{ commodityTypeId, typeNameSnapshot, label, rate }`. A legacy rate `code`
  may only be read by the explicitly selected transition fallback and is never
  emitted by a new write.
- BL/AN/DO Package Type selectors read the Freight Forwarding scope of
  `/v1/admin/commodity-types`; there is no separate Package Type API. Historical
  document payloads retain their stored Package Type text.
