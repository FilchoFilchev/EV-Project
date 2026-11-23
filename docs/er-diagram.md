# EchoVault entity relationship diagram

This diagram follows the checked-in core migration and subsequent forward-only
migrations, including `listings.preview_duration_seconds`. There are **eight
public application tables**. Supabase's `auth.users` and Storage objects are
managed platform data; the Marketplace summary is a view, not a ninth application
table. Current remote schema parity is not established by this diagram.

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "signup trigger"
  PROFILES ||--|| USER_ROLES : has
  PROFILES ||--|| SUBSCRIPTIONS : has
  PROFILES ||--o{ VOICE_RECORDINGS : owns
  VOICE_RECORDINGS ||--o{ VOICE_VERSIONS : contains
  VOICE_VERSIONS ||--o| LISTINGS : offers
  LISTINGS ||--o{ LICENSES : licenses
  PROFILES ||--o{ LICENSES : acquires
  LISTINGS ||--o{ REPORTS : receives
  PROFILES ||--o{ REPORTS : submits

  AUTH_USERS {
    uuid id PK
  }
  PROFILES {
    uuid id PK,FK
    text display_name
    text avatar_path "nullable"
    timestamptz created_at
    timestamptz updated_at
  }
  USER_ROLES {
    uuid user_id PK,FK
    text role "user or admin"
  }
  SUBSCRIPTIONS {
    uuid user_id PK,FK
    text plan "free or premium"
    timestamptz expires_at "nullable"
    timestamptz updated_at
  }
  VOICE_RECORDINGS {
    uuid id PK
    uuid owner_id FK
    varchar title
    text description "nullable"
    text category
    text visibility "private or public"
    timestamptz created_at
    timestamptz updated_at
  }
  VOICE_VERSIONS {
    uuid id PK
    uuid recording_id FK
    text effect_type "original, muffle, distortion or echo"
    jsonb effect_settings
    text storage_path
    numeric duration_seconds
    text mime_type
    bigint file_size_bytes
    timestamptz created_at
  }
  LISTINGS {
    uuid id PK
    uuid version_id FK,UK
    text status "draft, published or archived"
    integer sale_price_cents "nullable"
    integer rental_price_cents "nullable"
    integer rental_days "30"
    char currency "EUR"
    text preview_path "nullable for legacy or draft rows"
    numeric preview_duration_seconds "nullable for legacy rows"
    timestamptz created_at
  }
  LICENSES {
    uuid id PK
    uuid listing_id FK
    uuid buyer_id FK
    text license_type "buy or rent"
    integer price_cents
    timestamptz created_at
    timestamptz expires_at "null for buy, required for rent"
  }
  REPORTS {
    uuid id PK
    uuid listing_id FK
    uuid reporter_id FK
    text reason
    text status "open or resolved"
    timestamptz created_at
    timestamptz resolved_at "set once on resolution"
  }
```

## Tables and normalization

| Table | Purpose and relationship |
|---|---|
| `profiles` | Display identity without exposing Auth email. Its primary key also references `auth.users.id`. |
| `user_roles` | One stored authorization role per profile. Separating it from editable profile metadata prevents self-promotion. |
| `subscriptions` | One plan/expiry per profile. Premium is a subscription, independent of role. |
| `voice_recordings` | Recording identity, owner, title/category/description and metadata visibility. |
| `voice_versions` | Immutable original/effect output and its private object metadata. Many versions can share one recording. |
| `listings` | At most one offer per exact version, with demo euro-cent prices and separate public preview metadata. |
| `licenses` | A buyer's immutable purchase/rental receipt and historical price/expiry, linked to the listed version through the listing. |
| `reports` | Reporter evidence and review state for an offer. Resolving a report preserves its original reason and timestamps. |

The model avoids repeating seller/recording identity in licenses: those are
derived through listing → version → recording. `licenses.price_cents` is an
intentional historical price snapshot, so a receipt does not depend on a current
offer price. `effect_settings` stores effect-specific intensity metadata rather
than duplicating columns for each effect.

## Constraints and preservation

- Primary/foreign keys establish identity and referential integrity. Profile,
  role and subscription links cascade from Auth/profile deletion, but ownership,
  version, listing, license and report references use `ON DELETE RESTRICT`.
  Existing licensed media is therefore not silently removed through cascades.
- `voice_versions_one_original_per_recording` is a partial unique index for
  `effect_type = 'original'`. It enforces **at most one** original; the checked
  original-creation RPC supplies exactly one in its metadata transaction.
- `listings.version_id` is unique, including archived offers. Archival keeps
  the version relationship and existing licenses intact.
- `licenses_one_permanent_buy_per_listing` prevents duplicate permanent buys for
  the same buyer/listing. Rentals can have historical rows; the checkout RPC
  serializes active-rental retries and uses DB time rather than browser time.
- Prices are positive integers, at least one listing offer is required, currency
  is EUR and rent duration is 30 days. Buy receipts have null expiry; rentals
  require expiry. RPCs derive the actual timestamps and prices server-side.
- Report reason length is 1–1000 characters. Open reports have no resolution
  timestamp; resolved reports require one. A non-unique reporter/listing index
  preserves legacy duplicates while the report RPC prevents new duplicate pairs.
- All eight public tables enable RLS. Column grants, RLS policies, private helpers
  and protected RPCs work together; table relationships alone do not authorize
  access. Consult [architecture](architecture.md) and the focused SQL suites in
  `supabase/tests/` for the intended positive and negative cases.

`voice_versions.storage_path` and `listings.preview_path` reference object names
by validated text rather than SQL foreign keys into `storage.objects`. Checked
RPC/policy logic validates object ownership/metadata and protects referenced
objects from client cleanup. `marketplace_listing_summaries` deliberately omits
the private full-audio path.
