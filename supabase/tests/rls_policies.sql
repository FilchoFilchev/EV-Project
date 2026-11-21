begin;

do $setup_check$
declare
  v_email text;
  v_emails text[] := array[
    'rls-user-a@example.test',
    'rls-user-b@example.test',
    'rls-premium-active@example.test',
    'rls-premium-expired@example.test',
    'rls-premium-no-expiry@example.test',
    'rls-admin@example.test',
    'rls-licensed-buyer@example.test'
  ];
begin
  foreach v_email in array v_emails loop
    if not exists (
      select 1 from auth.users as u where u.email = v_email
    ) then
      raise exception 'Missing test auth user: %', v_email;
    end if;

    if not exists (
      select 1
      from public.profiles as p
      join auth.users as u on u.id = p.id
      where u.email = v_email
    ) then
      raise exception 'Signup bootstrap profile missing for: %', v_email;
    end if;
  end loop;
end;
$setup_check$;

select pg_catalog.set_config(
  'echovault.rls.user_a',
  (select u.id::text from auth.users as u where u.email = 'rls-user-a@example.test'),
  true
);
select pg_catalog.set_config(
  'echovault.rls.user_b',
  (select u.id::text from auth.users as u where u.email = 'rls-user-b@example.test'),
  true
);
select pg_catalog.set_config(
  'echovault.rls.premium_active',
  (select u.id::text from auth.users as u where u.email = 'rls-premium-active@example.test'),
  true
);
select pg_catalog.set_config(
  'echovault.rls.premium_expired',
  (select u.id::text from auth.users as u where u.email = 'rls-premium-expired@example.test'),
  true
);
select pg_catalog.set_config(
  'echovault.rls.premium_no_expiry',
  (select u.id::text from auth.users as u where u.email = 'rls-premium-no-expiry@example.test'),
  true
);
select pg_catalog.set_config(
  'echovault.rls.admin',
  (select u.id::text from auth.users as u where u.email = 'rls-admin@example.test'),
  true
);
select pg_catalog.set_config(
  'echovault.rls.buyer',
  (select u.id::text from auth.users as u where u.email = 'rls-licensed-buyer@example.test'),
  true
);

update public.user_roles
set role = case
  when user_id = current_setting('echovault.rls.admin')::uuid then 'admin'
  else 'user'
end
where user_id in (
  current_setting('echovault.rls.user_a')::uuid,
  current_setting('echovault.rls.user_b')::uuid,
  current_setting('echovault.rls.premium_active')::uuid,
  current_setting('echovault.rls.premium_expired')::uuid,
  current_setting('echovault.rls.premium_no_expiry')::uuid,
  current_setting('echovault.rls.admin')::uuid,
  current_setting('echovault.rls.buyer')::uuid
);

update public.subscriptions
set plan = 'free', expires_at = null
where user_id in (
  current_setting('echovault.rls.user_a')::uuid,
  current_setting('echovault.rls.user_b')::uuid,
  current_setting('echovault.rls.admin')::uuid,
  current_setting('echovault.rls.buyer')::uuid
);

update public.subscriptions
set plan = 'premium', expires_at = pg_catalog.now() + interval '30 days'
where user_id = current_setting('echovault.rls.premium_active')::uuid;

update public.subscriptions
set plan = 'premium', expires_at = pg_catalog.now() - interval '1 day'
where user_id = current_setting('echovault.rls.premium_expired')::uuid;

update public.subscriptions
set plan = 'premium', expires_at = null
where user_id = current_setting('echovault.rls.premium_no_expiry')::uuid;

select
  pg_catalog.set_config('echovault.rls.recording_a_public', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.recording_a_private', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.recording_b_public', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.recording_premium', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.recording_expired', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.recording_premium_no_expiry', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_a_public', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_a_private', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_b_public', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_premium', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_expired', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_premium_no_expiry', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_a_rent', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.version_a_archived', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.listing_a_published', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.listing_a_draft', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.listing_b_published', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.listing_a_rent', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.listing_a_archived', pg_catalog.gen_random_uuid()::text, true),
  pg_catalog.set_config('echovault.rls.report_a', pg_catalog.gen_random_uuid()::text, true);

insert into public.voice_recordings
  (id, owner_id, title, description, category, visibility)
values
  (current_setting('echovault.rls.recording_a_public')::uuid,
   current_setting('echovault.rls.user_a')::uuid, 'RLS A public', 'Public test recording', 'test', 'public'),
  (current_setting('echovault.rls.recording_a_private')::uuid,
   current_setting('echovault.rls.user_a')::uuid, 'RLS A private', 'Private test recording', 'test', 'private'),
  (current_setting('echovault.rls.recording_b_public')::uuid,
   current_setting('echovault.rls.user_b')::uuid, 'RLS B public', 'Public test recording', 'test', 'public'),
  (current_setting('echovault.rls.recording_premium')::uuid,
   current_setting('echovault.rls.premium_active')::uuid, 'RLS Premium', 'Premium test recording', 'test', 'private'),
  (current_setting('echovault.rls.recording_expired')::uuid,
   current_setting('echovault.rls.premium_expired')::uuid, 'RLS Expired', 'Expired Premium test recording', 'test', 'private'),
  (current_setting('echovault.rls.recording_premium_no_expiry')::uuid,
   current_setting('echovault.rls.premium_no_expiry')::uuid, 'RLS Premium Null Expiry', 'Unbounded Premium test recording', 'test', 'private');

insert into public.voice_versions
  (id, recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
values
  (current_setting('echovault.rls.version_a_public')::uuid,
   current_setting('echovault.rls.recording_a_public')::uuid, 'original', '{}'::jsonb,
   current_setting('echovault.rls.user_a') || '/' || current_setting('echovault.rls.version_a_public') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_a_private')::uuid,
   current_setting('echovault.rls.recording_a_private')::uuid, 'original', '{}'::jsonb,
   current_setting('echovault.rls.user_a') || '/' || current_setting('echovault.rls.version_a_private') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_b_public')::uuid,
   current_setting('echovault.rls.recording_b_public')::uuid, 'original', '{}'::jsonb,
   current_setting('echovault.rls.user_b') || '/' || current_setting('echovault.rls.version_b_public') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_premium')::uuid,
   current_setting('echovault.rls.recording_premium')::uuid, 'original', '{}'::jsonb,
   current_setting('echovault.rls.premium_active') || '/' || current_setting('echovault.rls.version_premium') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_expired')::uuid,
   current_setting('echovault.rls.recording_expired')::uuid, 'original', '{}'::jsonb,
   current_setting('echovault.rls.premium_expired') || '/' || current_setting('echovault.rls.version_expired') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_premium_no_expiry')::uuid,
   current_setting('echovault.rls.recording_premium_no_expiry')::uuid, 'original', '{}'::jsonb,
   current_setting('echovault.rls.premium_no_expiry') || '/' || current_setting('echovault.rls.version_premium_no_expiry') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_a_rent')::uuid,
   current_setting('echovault.rls.recording_a_public')::uuid, 'muffle', '{}'::jsonb,
   current_setting('echovault.rls.user_a') || '/' || current_setting('echovault.rls.version_a_rent') || '.wav', 1, 'audio/wav', 1000),
  (current_setting('echovault.rls.version_a_archived')::uuid,
   current_setting('echovault.rls.recording_a_public')::uuid, 'echo', '{}'::jsonb,
   current_setting('echovault.rls.user_a') || '/' || current_setting('echovault.rls.version_a_archived') || '.wav', 1, 'audio/wav', 1000);

insert into public.listings
  (id, version_id, status, sale_price_cents, rental_price_cents, preview_path)
values
  (current_setting('echovault.rls.listing_a_published')::uuid,
   current_setting('echovault.rls.version_a_public')::uuid, 'published', 1000, 100,
   current_setting('echovault.rls.user_a') || '/preview-a.wav'),
  (current_setting('echovault.rls.listing_a_draft')::uuid,
   current_setting('echovault.rls.version_a_private')::uuid, 'draft', 1000, null, null),
  (current_setting('echovault.rls.listing_b_published')::uuid,
   current_setting('echovault.rls.version_b_public')::uuid, 'published', 1000, 100,
   current_setting('echovault.rls.user_b') || '/preview-b.wav'),
  (current_setting('echovault.rls.listing_a_rent')::uuid,
   current_setting('echovault.rls.version_a_rent')::uuid, 'published', null, 100,
   current_setting('echovault.rls.user_a') || '/preview-rent.wav'),
  (current_setting('echovault.rls.listing_a_archived')::uuid,
   current_setting('echovault.rls.version_a_archived')::uuid, 'archived', 1000, null,
   current_setting('echovault.rls.user_a') || '/preview-archived.wav');

insert into public.licenses
  (listing_id, buyer_id, license_type, price_cents, expires_at)
values
  (current_setting('echovault.rls.listing_a_published')::uuid,
   current_setting('echovault.rls.buyer')::uuid, 'buy', 1000, null),
  (current_setting('echovault.rls.listing_a_rent')::uuid,
   current_setting('echovault.rls.buyer')::uuid, 'rent', 100,
   pg_catalog.now() + interval '1 day'),
  (current_setting('echovault.rls.listing_b_published')::uuid,
   current_setting('echovault.rls.buyer')::uuid, 'rent', 100,
   pg_catalog.now() - interval '1 day'),
  (current_setting('echovault.rls.listing_a_archived')::uuid,
   current_setting('echovault.rls.buyer')::uuid, 'buy', 1000, null);

insert into public.reports (id, listing_id, reporter_id, reason)
values (
  current_setting('echovault.rls.report_a')::uuid,
  current_setting('echovault.rls.listing_a_published')::uuid,
  current_setting('echovault.rls.user_a')::uuid,
  'RLS test report'
);

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '{}', true);
set local role anon;

do $anonymous_tests$
declare
  v_table text;
  v_tables text[] := array[
    'profiles',
    'user_roles',
    'subscriptions',
    'voice_recordings',
    'voice_versions',
    'listings',
    'licenses',
    'reports'
  ];
begin
  foreach v_table in array v_tables loop
    begin
      execute pg_catalog.format('select 1 from public.%I limit 1', v_table);
      raise exception 'FAIL: anon unexpectedly selected %', v_table;
    exception when insufficient_privilege then
      null;
    end;

    begin
      execute pg_catalog.format('insert into public.%I default values', v_table);
      raise exception 'FAIL: anon unexpectedly inserted into %', v_table;
    exception when insufficient_privilege then
      null;
    end;
  end loop;

  begin
    perform 1 from public.marketplace_listing_summaries limit 1;
    raise exception 'FAIL: anon unexpectedly selected marketplace summaries';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform private.is_admin();
    raise exception 'FAIL: anon unexpectedly executed a private helper';
  exception when insufficient_privilege then
    null;
  end;
end;
$anonymous_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.user_a'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.user_a'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $user_a_tests$
declare
  v_count bigint;
  v_rows bigint;
  v_new_recording_id uuid;
  v_new_version_id uuid;
  v_new_report_id uuid;
begin
  if current_user <> 'authenticated'
     or auth.uid() <> current_setting('echovault.rls.user_a')::uuid
     or current_setting('request.jwt.claim.sub') <> auth.uid()::text
  then
    raise exception 'Test context is not authenticated as User A';
  end if;

  select count(*) into v_count from public.profiles where id = auth.uid();
  if v_count <> 1 then raise exception 'FAIL: User A cannot read own profile'; end if;

  begin
    execute 'select avatar_path from public.profiles where id = auth.uid()';
    raise exception 'FAIL: User A read a profile column outside the client grant';
  exception when insufficient_privilege then
    null;
  end;

  begin
    execute 'select * from public.profiles where id = auth.uid()';
    raise exception 'FAIL: SELECT * unexpectedly worked on restricted profiles';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.profiles set avatar_path = 'untrusted/path' where id = auth.uid();
    raise exception 'FAIL: User A updated a profile column outside the client grant';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_count
  from public.profiles
  where id = current_setting('echovault.rls.user_b')::uuid;
  if v_count <> 1 then raise exception 'FAIL: published author profile is not visible'; end if;

  select count(*) into v_count
  from public.profiles
  where id = current_setting('echovault.rls.premium_expired')::uuid;
  if v_count <> 0 then raise exception 'FAIL: private non-author profile is visible'; end if;

  update public.profiles
  set display_name = display_name || ' test'
  where id = auth.uid();
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: User A cannot update own display name'; end if;

  begin
    update public.profiles
    set id = current_setting('echovault.rls.user_b')::uuid
    where id = auth.uid();
    raise exception 'FAIL: User A changed profile id';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_count from public.user_roles where user_id = auth.uid() and role = 'user';
  if v_count <> 1 then raise exception 'FAIL: User A cannot read own role'; end if;

  select count(*) into v_count
  from public.user_roles
  where user_id = current_setting('echovault.rls.user_b')::uuid;
  if v_count <> 0 then raise exception 'FAIL: User A read another user role'; end if;

  begin
    update public.user_roles set role = 'admin' where user_id = auth.uid();
    raise exception 'FAIL: User A changed own role';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.user_roles (user_id, role) values (auth.uid(), 'admin');
    raise exception 'FAIL: User A inserted an admin role';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_count
  from public.subscriptions
  where user_id = auth.uid() and plan = 'free';
  if v_count <> 1 then raise exception 'FAIL: User A cannot read own subscription'; end if;

  begin
    update public.subscriptions set plan = 'premium', expires_at = pg_catalog.now() + interval '30 days'
    where user_id = auth.uid();
    raise exception 'FAIL: User A changed own subscription';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.subscriptions (user_id, plan, expires_at)
    values (auth.uid(), 'premium', pg_catalog.now() + interval '30 days');
    raise exception 'FAIL: User A inserted a Premium subscription';
  exception when insufficient_privilege then
    null;
  end;

  update public.voice_recordings
  set title = 'RLS A private updated'
  where id = current_setting('echovault.rls.recording_a_private')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: User A cannot update own recording'; end if;

  update public.voice_recordings
  set title = 'unauthorized'
  where id = current_setting('echovault.rls.recording_b_public')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: User A updated User B recording'; end if;

  begin
    update public.voice_recordings
    set owner_id = current_setting('echovault.rls.user_b')::uuid
    where id = current_setting('echovault.rls.recording_a_private')::uuid;
    raise exception 'FAIL: User A reassigned recording ownership';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.voice_recordings (owner_id, title, description, category)
    values (current_setting('echovault.rls.user_b')::uuid, 'Spoofed', null, 'test');
    raise exception 'FAIL: User A inserted a recording for User B';
  exception when insufficient_privilege then
    null;
  end;

  select count(storage_path) into v_count
  from public.voice_versions
  where id = current_setting('echovault.rls.version_b_public')::uuid;
  if v_count <> 0 then raise exception 'FAIL: User A read User B version/path'; end if;

  if not private.owns_recording(current_setting('echovault.rls.recording_a_private')::uuid)
     or private.owns_recording(current_setting('echovault.rls.recording_b_public')::uuid)
     or private.is_admin()
     or private.is_premium()
  then
    raise exception 'FAIL: User A ownership/admin/Premium helper result is incorrect';
  end if;

  if not private.can_access_audio_path(
    current_setting('echovault.rls.user_a') || '/' ||
    current_setting('echovault.rls.version_a_private') || '.wav'
  ) then
    raise exception 'FAIL: owner cannot access own audio path';
  end if;

  if private.can_access_audio_path(
    current_setting('echovault.rls.user_b') || '/' ||
    current_setting('echovault.rls.version_b_public') || '.wav'
  ) then
    raise exception 'FAIL: public listing exposed User B private audio path';
  end if;

  select count(*) into v_count
  from public.marketplace_listing_summaries
  where listing_id = current_setting('echovault.rls.listing_a_published')::uuid;
  if v_count <> 1 then raise exception 'FAIL: published public listing missing from summary view'; end if;

  begin
    execute 'select storage_path from public.marketplace_listing_summaries limit 1';
    raise exception 'FAIL: marketplace summary exposed private storage_path';
  exception when undefined_column then
    null;
  end;

  select count(*) into v_count
  from public.marketplace_listing_summaries
  where listing_id in (
    current_setting('echovault.rls.listing_a_draft')::uuid,
    current_setting('echovault.rls.listing_a_archived')::uuid
  );
  if v_count <> 0 then raise exception 'FAIL: draft or archived listing leaked through summary view'; end if;

  update public.listings set sale_price_cents = 1200
  where id = current_setting('echovault.rls.listing_a_draft')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: owner cannot update own listing'; end if;

  update public.listings set sale_price_cents = 1
  where id = current_setting('echovault.rls.listing_b_published')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: User A updated User B listing'; end if;

  begin
    update public.listings
    set version_id = current_setting('echovault.rls.version_b_public')::uuid
    where id = current_setting('echovault.rls.listing_a_draft')::uuid;
    raise exception 'FAIL: User A changed immutable listing version';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.listings (version_id, status, sale_price_cents)
    values (current_setting('echovault.rls.version_b_public')::uuid, 'draft', 100);
    raise exception 'FAIL: User A listed User B version';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.voice_recordings (owner_id, title, description, category)
  values (auth.uid(), 'RLS new recording', null, 'test')
  returning id into v_new_recording_id;
  if v_new_recording_id is null then raise exception 'FAIL: recording INSERT RETURNING returned no id'; end if;

  insert into public.voice_versions
    (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
  values
    (v_new_recording_id, 'original', '{}'::jsonb,
     auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', 1, 'audio/wav', 1000)
  returning id into v_new_version_id;
  if v_new_version_id is null then raise exception 'FAIL: User A cannot create original version'; end if;

  begin
    insert into public.voice_versions
      (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
    values
      (v_new_recording_id, 'original', '{}'::jsonb,
       current_setting('echovault.rls.user_a') || '/' ||
         current_setting('echovault.rls.version_a_public') || '.wav',
       1, 'audio/wav', 1000);
    raise exception 'FAIL: two versions referenced the same storage path';
  exception when unique_violation then
    null;
  end;

  insert into public.listings (version_id, status, sale_price_cents)
  values (v_new_version_id, 'draft', 100);

  begin
    insert into public.voice_versions
      (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
    values
      (current_setting('echovault.rls.recording_a_private')::uuid, 'muffle', '{}'::jsonb,
       auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', 1, 'audio/wav', 1000);
    raise exception 'FAIL: Free User A created edited version';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.voice_versions
      (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
    values
      (current_setting('echovault.rls.recording_a_public')::uuid, 'original', '{}'::jsonb,
       auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', 1, 'audio/wav', 1000);
    raise exception 'FAIL: duplicate original version was inserted';
  exception when unique_violation then
    null;
  end;

  begin
    update public.voice_versions set effect_type = 'echo'
    where id = current_setting('echovault.rls.version_a_public')::uuid;
    raise exception 'FAIL: User A updated immutable version';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.voice_versions
    where id = current_setting('echovault.rls.version_a_public')::uuid;
    raise exception 'FAIL: User A deleted immutable version';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_count
  from public.licenses
  where buyer_id = auth.uid();
  if v_count <> 0 then raise exception 'FAIL: User A read another buyer license'; end if;

  select count(*) into v_count
  from public.licenses
  where listing_id = current_setting('echovault.rls.listing_a_published')::uuid;
  if v_count <> 0 then raise exception 'FAIL: seller read buyer license details'; end if;

  begin
    insert into public.licenses (listing_id, buyer_id, license_type, price_cents)
    values (
      current_setting('echovault.rls.listing_a_published')::uuid,
      auth.uid(),
      'buy',
      1000
    );
    raise exception 'FAIL: User A directly created a license';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.reports (listing_id, reporter_id, reason)
  values (current_setting('echovault.rls.listing_a_published')::uuid, auth.uid(), 'RLS report allowed')
  returning id into v_new_report_id;

  select count(*) into v_count
  from public.reports
  where id = v_new_report_id and status = 'open' and resolved_at is null;
  if v_count <> 1 then raise exception 'FAIL: report did not default to open'; end if;

  begin
    insert into public.reports (listing_id, reporter_id, reason)
    values (
      current_setting('echovault.rls.listing_a_published')::uuid,
      current_setting('echovault.rls.user_b')::uuid,
      'Spoofed reporter'
    );
    raise exception 'FAIL: User A submitted a report as User B';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.reports (listing_id, reporter_id, reason, status, resolved_at)
    values (
      current_setting('echovault.rls.listing_a_published')::uuid,
      auth.uid(),
      'Forged resolution',
      'resolved',
      pg_catalog.now()
    );
    raise exception 'FAIL: User A forged report resolution';
  exception when insufficient_privilege then
    null;
  end;

  update public.reports set status = 'resolved', resolved_at = pg_catalog.now()
  where id = v_new_report_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: ordinary user resolved a report'; end if;
end;
$user_a_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.user_b'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.user_b'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $user_b_tests$
declare
  v_count bigint;
  v_rows bigint;
begin
  if current_user <> 'authenticated' or auth.uid() <> current_setting('echovault.rls.user_b')::uuid then
    raise exception 'Test context is not authenticated as User B';
  end if;

  if private.is_admin() or private.is_premium() then
    raise exception 'FAIL: ordinary User B gained admin or Premium status';
  end if;

  select count(*) into v_count
  from public.voice_recordings
  where id = current_setting('echovault.rls.recording_a_private')::uuid;
  if v_count <> 0 then raise exception 'FAIL: User B read User A private recording'; end if;

  select count(*) into v_count
  from public.marketplace_listing_summaries
  where listing_id = current_setting('echovault.rls.listing_a_published')::uuid;
  if v_count <> 1 then raise exception 'FAIL: User B cannot browse published public listing'; end if;

  select count(*) into v_count
  from public.listings
  where id in (
    current_setting('echovault.rls.listing_a_draft')::uuid,
    current_setting('echovault.rls.listing_a_archived')::uuid
  );
  if v_count <> 0 then raise exception 'FAIL: User B read another seller draft/archive'; end if;

  update public.listings set sale_price_cents = 1
  where id = current_setting('echovault.rls.listing_a_published')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: User B modified User A listing'; end if;

  select count(storage_path) into v_count
  from public.voice_versions
  where id = current_setting('echovault.rls.version_a_public')::uuid;
  if v_count <> 0 then raise exception 'FAIL: published listing exposed private version path'; end if;

  select count(*) into v_count
  from public.reports
  where reporter_id = current_setting('echovault.rls.user_a')::uuid;
  if v_count <> 0 then raise exception 'FAIL: User B read User A report'; end if;

  if private.can_access_audio_path(
    current_setting('echovault.rls.user_a') || '/' ||
    current_setting('echovault.rls.version_a_public') || '.wav'
  ) then
    raise exception 'FAIL: published listing granted private audio access';
  end if;
end;
$user_b_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.premium_active'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.premium_active'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $premium_tests$
declare
  v_count bigint;
  v_edited_version_id uuid;
begin
  if not private.is_premium() then raise exception 'FAIL: active Premium not recognized'; end if;

  insert into public.voice_versions
    (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
  values
    (current_setting('echovault.rls.recording_premium')::uuid, 'muffle', '{}'::jsonb,
     auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', 1, 'audio/wav', 1000)
  returning id into v_edited_version_id;

  select count(*) into v_count
  from public.voice_versions
  where id = v_edited_version_id
    and recording_id = current_setting('echovault.rls.recording_premium')::uuid
    and effect_type = 'muffle';
  if v_count <> 1 then raise exception 'FAIL: active Premium could not create edited version'; end if;

  begin
    update public.subscriptions set plan = 'free', expires_at = null where user_id = auth.uid();
    raise exception 'FAIL: Premium user changed own subscription';
  exception when insufficient_privilege then
    null;
  end;
end;
$premium_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.premium_expired'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.premium_expired'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $expired_premium_tests$
begin
  if private.is_premium() then raise exception 'FAIL: expired Premium recognized as active'; end if;

  begin
    insert into public.voice_versions
      (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
    values
      (current_setting('echovault.rls.recording_expired')::uuid, 'echo', '{}'::jsonb,
       auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', 1, 'audio/wav', 1000);
    raise exception 'FAIL: expired Premium created edited version';
  exception when insufficient_privilege then
    null;
  end;
end;
$expired_premium_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.premium_no_expiry'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.premium_no_expiry'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $premium_no_expiry_tests$
begin
  if private.is_premium() then
    raise exception 'FAIL: Premium subscription with NULL expiry was treated as active';
  end if;

  begin
    insert into public.voice_versions
      (recording_id, effect_type, effect_settings, storage_path, duration_seconds, mime_type, file_size_bytes)
    values
      (current_setting('echovault.rls.recording_premium_no_expiry')::uuid, 'muffle', '{}'::jsonb,
       auth.uid()::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', 1, 'audio/wav', 1000);
    raise exception 'FAIL: NULL-expiry Premium created edited version';
  exception when insufficient_privilege then
    null;
  end;
end;
$premium_no_expiry_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.admin'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.admin'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $admin_tests$
declare
  v_count bigint;
  v_rows bigint;
begin
  if not private.is_admin() then raise exception 'FAIL: trusted admin role not recognized'; end if;

  select count(*) into v_count from public.user_roles;
  if v_count < 6 then raise exception 'FAIL: admin cannot review roles'; end if;

  select count(*) into v_count from public.subscriptions;
  if v_count < 6 then raise exception 'FAIL: admin cannot review subscriptions'; end if;

  select count(*) into v_count from public.listings;
  if v_count < 5 then raise exception 'FAIL: admin cannot review listings'; end if;

  update public.reports
  set status = 'resolved', resolved_at = pg_catalog.now()
  where id = current_setting('echovault.rls.report_a')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: admin cannot resolve report'; end if;

  begin
    update public.user_roles set role = 'user'
    where user_id = current_setting('echovault.rls.admin')::uuid;
    raise exception 'FAIL: admin changed role directly';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.subscriptions set plan = 'premium', expires_at = pg_catalog.now() + interval '30 days'
    where user_id = current_setting('echovault.rls.admin')::uuid;
    raise exception 'FAIL: admin changed subscription directly';
  exception when insufficient_privilege then
    null;
  end;

  if private.can_access_audio_path(
    current_setting('echovault.rls.user_a') || '/' ||
    current_setting('echovault.rls.version_a_private') || '.wav'
  ) then
    raise exception 'FAIL: admin role alone granted private audio access';
  end if;

  select count(*) into v_count
  from public.voice_versions
  where id = current_setting('echovault.rls.version_a_private')::uuid;
  if v_count <> 0 then raise exception 'FAIL: admin can read another user private version path'; end if;
end;
$admin_tests$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('echovault.rls.buyer'), true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', current_setting('echovault.rls.buyer'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $licensed_buyer_tests$
declare
  v_count bigint;
begin
  if private.is_admin() or private.is_premium() then
    raise exception 'FAIL: licensed buyer unexpectedly has admin/Premium status';
  end if;

  select count(*) into v_count from public.licenses where buyer_id = auth.uid();
  if v_count <> 4 then raise exception 'FAIL: buyer cannot read own license history'; end if;

  if not private.can_access_audio_path(
    current_setting('echovault.rls.user_a') || '/' ||
    current_setting('echovault.rls.version_a_public') || '.wav'
  ) then
    raise exception 'FAIL: permanent buy did not grant audio path access';
  end if;

  if not private.can_access_audio_path(
    current_setting('echovault.rls.user_a') || '/' ||
    current_setting('echovault.rls.version_a_rent') || '.wav'
  ) then
    raise exception 'FAIL: unexpired rental did not grant audio path access';
  end if;

  if private.can_access_audio_path(
    current_setting('echovault.rls.user_b') || '/' ||
    current_setting('echovault.rls.version_b_public') || '.wav'
  ) then
    raise exception 'FAIL: expired rental granted audio path access';
  end if;

  if not private.can_access_audio_path(
    current_setting('echovault.rls.user_a') || '/' ||
    current_setting('echovault.rls.version_a_archived') || '.wav'
  ) then
    raise exception 'FAIL: archived listing revoked permanent license';
  end if;

  select count(*) into v_count
  from public.voice_versions
  where id = current_setting('echovault.rls.version_a_archived')::uuid;
  if v_count <> 1 then raise exception 'FAIL: permanent license cannot read archived version'; end if;

  select count(*) into v_count
  from public.listings
  where id = current_setting('echovault.rls.listing_a_archived')::uuid;
  if v_count <> 1 then raise exception 'FAIL: archived listing hid valid license history'; end if;

  select count(*) into v_count
  from public.voice_versions
  where id = current_setting('echovault.rls.version_b_public')::uuid;
  if v_count <> 0 then raise exception 'FAIL: expired rental retained version access'; end if;
end;
$licensed_buyer_tests$;

reset role;
select 'all RLS policy assertions passed; fixture transaction will roll back' as test_result;
rollback;
