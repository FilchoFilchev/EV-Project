-- MANUAL TEMPLATE ONLY. Never execute as a migration or from browser code.
-- Use a trusted SQL connection to an isolated local Supabase first. Any future
-- remote execution needs explicit approval and verification in the dashboard:
-- echovault-dev / zysyghbbbesatbehravb. NEVER use the primary echovault project.
-- Register ONE NEW disposable development-only account normally. Independently
-- verify its UUID and exact stored email in Auth Users, then set BOTH NULL values
-- in a private copy of this template. Leave the committed template disabled.
-- Do not select existing Free User A, seller User B, Premium testers, or a real
-- account. The unedited template always aborts. This is not a client RPC.
begin;

do $bootstrap_demo_admin$
declare
  v_demo_admin_id uuid := null;
  v_demo_admin_email text := null;
  v_promoted_count integer;
begin
  if v_demo_admin_id is null then
    raise exception 'Set the verified disposable demo account UUID deliberately in this manual template.';
  end if;
  if v_demo_admin_email is null or pg_catalog.btrim(v_demo_admin_email) = '' then
    raise exception 'Set the exact verified email of the same NEW disposable development account.';
  end if;
  if not exists (
    select 1 from auth.users as u join public.profiles as p on p.id = u.id
    where u.id = v_demo_admin_id and u.email = v_demo_admin_email
  ) then
    raise exception 'UUID/email mismatch or missing bootstrap profile. No account was promoted.';
  end if;
  update public.user_roles as ur set role = 'admin'
  from auth.users as u
  where ur.user_id = v_demo_admin_id and ur.role = 'user'
    and u.id = ur.user_id and u.email = v_demo_admin_email;
  get diagnostics v_promoted_count = row_count;
  if v_promoted_count <> 1 then
    raise exception 'Expected exactly one matching ordinary user. No account was promoted.';
  end if;
  -- Role and Premium are independent. No subscription is changed here.
end;
$bootstrap_demo_admin$;

commit;
