-- KarenPay Unit 7: one-time mandate consumption using the database clock.
-- This is intentionally one guarded UPDATE so concurrent approvals have one winner.

create function public.consume_mandate(
  p_mandate_id uuid,
  p_account_id uuid
)
returns setof public.mandates
language sql
security definer
set search_path = public
as $$
  update public.mandates as mandate
  set state = 'CONSUMED'
  where mandate.id = p_mandate_id
    and mandate.account_id = p_account_id
    and mandate.state = 'CREATED'
    and mandate.expires_at > now()
  returning mandate.*;
$$;

revoke all on function public.consume_mandate(uuid, uuid) from public;
grant execute on function public.consume_mandate(uuid, uuid) to service_role;
