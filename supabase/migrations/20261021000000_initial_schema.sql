-- KarenPay Unit 3: additive database schema.
-- Supabase Auth is not used; the API owns authentication and access checks.

create extension if not exists pgcrypto;

create type public.mandate_state as enum (
  'CREATED',
  'CONSUMED',
  'PAID',
  'FAILED',
  'REJECTED',
  'EXPIRED'
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.passkey_credentials (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  created_at timestamptz not null default now()
);

create index passkey_credentials_account_id_idx
  on public.passkey_credentials(account_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  display_name text not null,
  paypal_sandbox_email text not null,
  created_at timestamptz not null default now(),
  unique (id, account_id),
  unique (account_id, display_name)
);

create index contacts_account_id_idx on public.contacts(account_id);

create function public.enforce_contact_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.contacts
    where account_id = new.account_id
  ) >= 5 then
    raise exception 'an account may have at most 5 contacts';
  end if;
  return new;
end;
$$;

create trigger contacts_limit_before_insert
before insert on public.contacts
for each row execute function public.enforce_contact_limit();

create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  action text not null check (action = 'send_money'),
  payee_contact_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = upper(currency)),
  constraints jsonb not null default '{}'::jsonb,
  request_hash text not null,
  nonce text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  spoken_text text not null,
  mandate_hash text not null,
  state public.mandate_state not null default 'CREATED',
  paypal_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (payee_contact_id, account_id)
    references public.contacts(id, account_id)
    on delete restrict,
  check (expires_at > issued_at)
);

create index mandates_account_id_idx on public.mandates(account_id);
create index mandates_payee_contact_id_idx on public.mandates(payee_contact_id);
create index mandates_state_expires_at_idx
  on public.mandates(state, expires_at);

create function public.set_mandates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mandates_updated_at
before update on public.mandates
for each row execute function public.set_mandates_updated_at();

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid references public.mandates(id) on delete set null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null,
  created_at timestamptz not null default now()
);

create index audit_events_account_created_at_idx
  on public.audit_events(account_id, created_at);
create index audit_events_mandate_id_idx
  on public.audit_events(mandate_id);
create unique index audit_events_hash_idx on public.audit_events(hash);
