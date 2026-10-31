-- KarenPay Unit B1: Bulk Pay additive schema and simulated sandbox directory.
-- Everything in this table is simulated sandbox test data. No live bank or real money.

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  status text not null default 'PARSED' check (
    status in (
      'PARSED',
      'PLANNED',
      'CONFIRMED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED'
    )
  ),
  plan_hash text,
  total_minor bigint not null default 0 check (total_minor >= 0),
  currency text not null default 'USD' check (currency = upper(currency)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  check (expires_at > created_at)
);

create index batches_account_id_idx on public.batches(account_id);
create index batches_status_expires_at_idx on public.batches(status, expires_at);

create table public.batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  position integer not null check (position >= 0 and position < 5),
  pasted_name text not null,
  resolved_name text,
  bank_name text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  status text not null check (
    status in (
      'MATCHED',
      'NAME_MISMATCH',
      'NOT_FOUND',
      'DUPLICATE',
      'SKIPPED',
      'READY',
      'ACTIVE',
      'CONSUMED',
      'PAID',
      'FAILED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED'
    )
  ),
  amount_minor bigint check (amount_minor is null or amount_minor > 0),
  mandate_id uuid references public.mandates(id) on delete set null,
  unique (batch_id, position)
);

create index batch_items_batch_id_position_idx on public.batch_items(batch_id, position);
create unique index batch_items_mandate_id_idx
  on public.batch_items(mandate_id)
  where mandate_id is not null;

create function public.enforce_batch_item_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.batch_items
    where batch_id = new.batch_id
  ) >= 5 then
    raise exception 'a bulk batch may have at most 5 recipients';
  end if;
  return new;
end;
$$;

create trigger batch_items_limit_before_insert
before insert on public.batch_items
for each row execute function public.enforce_batch_item_limit();

create table public.sandbox_directory (
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  bank_name text not null,
  account_name text not null,
  paypal_sandbox_email text not null,
  primary key (account_number, bank_name)
);

-- Seeded simulated directory (12 records).
-- Includes exact matches and entries designed to demonstrate name-mismatch checks
-- (e.g., pasting "Chidi Okafor" for 0234567890 when directory holds "Chidinma Okafor",
-- or pasting "Babatunde Bakare" for 0345678901 when directory holds "Tunde Bakare").
insert into public.sandbox_directory (
  account_number,
  bank_name,
  account_name,
  paypal_sandbox_email
) values
  ('0700000000', 'Cleva Bank', 'Olayinka Emmanuel', 'olayinka.cleva@sandbox.karenpay.test'),
  ('0123456789', 'Guaranty Trust Bank', 'Ade Bello', 'ade.gtb@sandbox.karenpay.test'),
  ('0234567890', 'Access Bank', 'Chidinma Okafor', 'chidinma.access@sandbox.karenpay.test'),
  ('0345678901', 'Zenith Bank', 'Tunde Bakare', 'tunde.zenith@sandbox.karenpay.test'),
  ('0456789012', 'United Bank for Africa', 'Ngozi Eze', 'ngozi.uba@sandbox.karenpay.test'),
  ('0567890123', 'First Bank of Nigeria', 'Ibrahim Musa', 'ibrahim.firstbank@sandbox.karenpay.test'),
  ('0678901234', 'Kuda Bank', 'Amina Yusuf', 'amina.kuda@sandbox.karenpay.test'),
  ('0789012345', 'OPay', 'Emeka Nwosu', 'emeka.opay@sandbox.karenpay.test'),
  ('0890123456', 'Moniepoint', 'Funke Akindele', 'funke.moniepoint@sandbox.karenpay.test'),
  ('0901234567', 'PalmPay', 'Sadiq Abubakar', 'sadiq.palmpay@sandbox.karenpay.test'),
  ('1012345678', 'Fidelity Bank', 'Kemi Adebayo', 'kemi.fidelity@sandbox.karenpay.test'),
  ('1123456789', 'Stanbic IBTC Bank', 'Damilola Ogunleye', 'damilola.stanbic@sandbox.karenpay.test')
on conflict (account_number, bank_name) do nothing;
