create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
    constraint profiles_display_name_length check (char_length(display_name) between 1 and 100),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null
    constraint user_roles_role_check check (role in ('user', 'admin'))
);

create table public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan text not null default 'free'
    constraint subscriptions_plan_check check (plan in ('free', 'premium')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.voice_recordings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  title varchar(120) not null
    constraint voice_recordings_title_length check (char_length(title) between 1 and 120),
  description text,
  category text not null
    constraint voice_recordings_category_length check (char_length(category) between 1 and 80),
  visibility text not null default 'private'
    constraint voice_recordings_visibility_check check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.voice_versions (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.voice_recordings(id) on delete restrict,
  effect_type text not null
    constraint voice_versions_effect_type_check
      check (effect_type in ('original', 'muffle', 'distortion', 'echo')),
  effect_settings jsonb not null default '{}'::jsonb,
  storage_path text not null
    constraint voice_versions_storage_path_format
      check (
        storage_path ~ '^[0-9a-fA-F-]{36}/[^/]+$'
        and char_length(storage_path) <= 500
      ),
  duration_seconds numeric(10, 3) not null
    constraint voice_versions_duration_positive check (duration_seconds > 0),
  mime_type text not null
    constraint voice_versions_mime_type_check
      check (
        mime_type in (
          'audio/wav',
          'audio/x-wav',
          'audio/mpeg',
          'audio/mp4',
          'audio/webm',
          'audio/ogg'
        )
      ),
  file_size_bytes bigint not null
    constraint voice_versions_file_size_positive check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique
    references public.voice_versions(id) on delete restrict,
  status text not null default 'draft'
    constraint listings_status_check check (status in ('draft', 'published', 'archived')),
  sale_price_cents integer
    constraint listings_sale_price_positive check (sale_price_cents > 0),
  rental_price_cents integer
    constraint listings_rental_price_positive check (rental_price_cents > 0),
  rental_days integer not null default 30
    constraint listings_rental_days_check check (rental_days = 30),
  currency char(3) not null default 'EUR'
    constraint listings_currency_check check (currency = 'EUR'),
  preview_path text,
  created_at timestamptz not null default now(),
  constraint listings_at_least_one_price
    check (sale_price_cents is not null or rental_price_cents is not null)
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null
    references public.listings(id) on delete restrict,
  buyer_id uuid not null
    references public.profiles(id) on delete restrict,
  license_type text not null
    constraint licenses_license_type_check check (license_type in ('buy', 'rent')),
  price_cents integer not null
    constraint licenses_price_positive check (price_cents > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint licenses_expiry_check
    check (
      (license_type = 'buy' and expires_at is null)
      or (license_type = 'rent' and expires_at is not null)
    )
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null
    references public.listings(id) on delete restrict,
  reporter_id uuid not null
    references public.profiles(id) on delete restrict,
  reason text not null
    constraint reports_reason_length check (char_length(reason) between 1 and 1000),
  status text not null default 'open'
    constraint reports_status_check check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reports_resolution_consistency
    check (
      (status = 'open' and resolved_at is null)
      or (status = 'resolved' and resolved_at is not null)
    )
);

create unique index voice_versions_one_original_per_recording
  on public.voice_versions(recording_id)
  where effect_type = 'original';

create unique index licenses_one_permanent_buy_per_listing
  on public.licenses(listing_id, buyer_id)
  where license_type = 'buy';

create index voice_recordings_owner_id_idx on public.voice_recordings(owner_id);
create index voice_recordings_visibility_idx on public.voice_recordings(visibility);
create index voice_recordings_created_at_idx on public.voice_recordings(created_at desc);

create index voice_versions_recording_id_idx on public.voice_versions(recording_id);
create index voice_versions_effect_type_idx on public.voice_versions(effect_type);

create index listings_status_idx on public.listings(status);
create index listings_created_at_idx on public.listings(created_at desc);

create index licenses_buyer_id_idx on public.licenses(buyer_id);
create index licenses_listing_id_idx on public.licenses(listing_id);
create index licenses_buyer_listing_idx on public.licenses(buyer_id, listing_id);

create index reports_status_idx on public.reports(status);
create index reports_reporter_id_idx on public.reports(reporter_id);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.voice_recordings enable row level security;
alter table public.voice_versions enable row level security;
alter table public.listings enable row level security;
alter table public.licenses enable row level security;
alter table public.reports enable row level security;
