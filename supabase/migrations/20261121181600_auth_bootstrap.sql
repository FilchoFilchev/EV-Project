create function public.handle_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_display_name text;
begin
  v_display_name := pg_catalog.left(
    pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'),
    100
  );

  if v_display_name is null or v_display_name = '' then
    v_display_name := 'EchoVault User';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan)
  values (new.id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

revoke all on function public.handle_new_user_signup() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user_signup();
