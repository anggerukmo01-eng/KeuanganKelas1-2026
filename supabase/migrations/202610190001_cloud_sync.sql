-- Supabase cloud sync backend for KeuanganKelas1-2026.
-- Apply this file once in Supabase SQL Editor as a project administrator.
-- The browser must use only the project's publishable/anon key. Never expose service_role.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_workspaces (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists public.app_workspace_members (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'teacher')),
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (workspace_id, user_id)
);
create index if not exists app_workspace_members_user_idx on public.app_workspace_members(user_id, workspace_id);

create table if not exists public.app_workspace_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  invite_hash text not null unique,
  role text not null default 'teacher' check (role = 'teacher'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  max_uses integer not null default 10 check (max_uses between 1 and 50),
  used_count integer not null default 0 check (used_count >= 0),
  revoked_at timestamptz
);
create index if not exists app_workspace_invites_workspace_idx on public.app_workspace_invites(workspace_id);

create table if not exists public.app_workspace_snapshots (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (pg_catalog.jsonb_typeof(payload) = 'object' and pg_catalog.pg_column_size(payload) <= 12582912),
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid not null references auth.users(id) on delete restrict
);

alter table public.app_workspaces enable row level security;
alter table public.app_workspace_members enable row level security;
alter table public.app_workspace_invites enable row level security;
alter table public.app_workspace_snapshots enable row level security;

-- Deny table writes from the browser. Mutations must go through validated RPCs.
revoke all on table public.app_workspaces from anon, authenticated;
revoke all on table public.app_workspace_members from anon, authenticated;
revoke all on table public.app_workspace_invites from anon, authenticated;
revoke all on table public.app_workspace_snapshots from anon, authenticated;
grant select on table public.app_workspaces, public.app_workspace_members, public.app_workspace_snapshots to authenticated;

create or replace function public.is_app_workspace_member(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_app_workspace_editor(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'teacher')
  );
$$;
revoke all on function public.is_app_workspace_member(uuid) from public, anon;
revoke all on function public.is_app_workspace_editor(uuid) from public, anon;
grant execute on function public.is_app_workspace_member(uuid) to authenticated;
grant execute on function public.is_app_workspace_editor(uuid) to authenticated;

drop policy if exists app_workspaces_member_select on public.app_workspaces;
create policy app_workspaces_member_select on public.app_workspaces
  for select to authenticated using (public.is_app_workspace_member(id));

drop policy if exists app_workspace_members_member_select on public.app_workspace_members;
create policy app_workspace_members_member_select on public.app_workspace_members
  for select to authenticated using (public.is_app_workspace_member(workspace_id) or user_id = (select auth.uid()));

drop policy if exists app_workspace_snapshots_member_select on public.app_workspace_snapshots;
create policy app_workspace_snapshots_member_select on public.app_workspace_snapshots
  for select to authenticated using (public.is_app_workspace_member(workspace_id));

create or replace function public.create_app_workspace(p_name text)
returns table(workspace_id uuid, workspace_name text, invite_code text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_code text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if pg_catalog.length(v_name) < 1 or pg_catalog.length(v_name) > 120 then raise exception 'WORKSPACE_NAME_INVALID' using errcode = '22023'; end if;
  insert into public.app_workspaces(name, owner_id) values (v_name, v_user) returning id, name into v_id, v_name;
  insert into public.app_workspace_members(workspace_id, user_id, role) values (v_id, v_user, 'owner');
  v_code := pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''));
  insert into public.app_workspace_invites(workspace_id, invite_hash, role, created_by, expires_at, max_uses)
    values (v_id, pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'), 'hex'), 'teacher', v_user, pg_catalog.now() + interval '30 days', 10);
  return query select v_id, v_name, v_code;
end;
$$;

create or replace function public.create_app_workspace_invite(p_workspace_id uuid, p_role text default 'teacher', p_days integer default 30)
returns table(invite_code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_expires timestamptz;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_role is distinct from 'teacher' then raise exception 'INVITE_ROLE_INVALID' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > 30 then raise exception 'INVITE_EXPIRY_MUST_BE_1_TO_30_DAYS' using errcode = '22023'; end if;
  if not exists (select 1 from public.app_workspace_members m where m.workspace_id = p_workspace_id and m.user_id = v_user and m.role in ('owner','teacher')) then
    raise exception 'WORKSPACE_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;
  v_code := pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''));
  v_expires := pg_catalog.now() + (p_days * interval '1 day');
  insert into public.app_workspace_invites(workspace_id, invite_hash, role, created_by, expires_at, max_uses)
    values (p_workspace_id, pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'), 'hex'), 'teacher', v_user, v_expires, 10);
  return query select v_code, v_expires;
end;
$$;

create or replace function public.join_app_workspace(p_invite_code text)
returns table(workspace_id uuid, workspace_name text, member_role text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text := pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_invite_code, '')), '\s', '', 'g'));
  v_hash text;
  v_invite public.app_workspace_invites%rowtype;
  v_name text;
  v_role text;
  v_added integer := 0;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if pg_catalog.length(v_code) <> 64 or v_code !~ '^[A-F0-9]{64}$' then raise exception 'INVITE_CODE_INVALID' using errcode = '22023'; end if;
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'), 'hex');
  select i.* into v_invite from public.app_workspace_invites i
    where i.invite_hash = v_hash and i.revoked_at is null and i.expires_at > pg_catalog.now() and i.used_count < i.max_uses
    for update;
  if not found then raise exception 'INVITE_INVALID_EXPIRED_OR_USED' using errcode = '22023'; end if;
  select w.name into v_name from public.app_workspaces w where w.id = v_invite.workspace_id;
  if v_name is null then raise exception 'WORKSPACE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.app_workspace_members(workspace_id, user_id, role)
    values (v_invite.workspace_id, v_user, v_invite.role) on conflict (workspace_id, user_id) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then update public.app_workspace_invites set used_count = used_count + 1 where id = v_invite.id; end if;
  select m.role into v_role from public.app_workspace_members m where m.workspace_id = v_invite.workspace_id and m.user_id = v_user;
  return query select v_invite.workspace_id, v_name, v_role;
end;
$$;

create or replace function public.save_app_workspace_snapshot(p_workspace_id uuid, p_expected_revision bigint, p_payload jsonb)
returns table(revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_current bigint := 0;
  v_next bigint;
  v_updated timestamptz;
  v_tx jsonb;
  v_item jsonb;
  v_item_sum numeric;
  v_total numeric;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_workspace_id is null then raise exception 'WORKSPACE_REQUIRED' using errcode = '22023'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'EXPECTED_REVISION_REQUIRED' using errcode = '22023'; end if;
  if not exists (select 1 from public.app_workspace_members m where m.workspace_id = p_workspace_id and m.user_id = v_user and m.role in ('owner','teacher')) then
    raise exception 'WORKSPACE_EDITOR_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' or pg_catalog.pg_column_size(p_payload) > 12582912 then raise exception 'PAYLOAD_INVALID_OR_TOO_LARGE' using errcode = '22023'; end if;
  if p_payload->>'schema' is distinct from 'keuangan-kelas-backup' then raise exception 'BACKUP_SCHEMA_INVALID' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(p_payload->'students') is distinct from 'array' then raise exception 'STUDENTS_ARRAY_INVALID' using errcode = '22023'; end if;
  if pg_catalog.jsonb_array_length(p_payload->'students') < 1 or pg_catalog.jsonb_array_length(p_payload->'students') > 2000 then raise exception 'STUDENTS_ARRAY_INVALID' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(p_payload->'paymentTypes') is distinct from 'array' then raise exception 'PAYMENT_TYPES_ARRAY_INVALID' using errcode = '22023'; end if;
  if pg_catalog.jsonb_array_length(p_payload->'paymentTypes') > 500 then raise exception 'PAYMENT_TYPES_ARRAY_INVALID' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(p_payload->'transactions') is distinct from 'array' then raise exception 'TRANSACTIONS_ARRAY_INVALID' using errcode = '22023'; end if;
  if pg_catalog.jsonb_array_length(p_payload->'transactions') > 100000 then raise exception 'TRANSACTIONS_ARRAY_INVALID' using errcode = '22023'; end if;
  if p_payload ? 'auditLogs' then
    if pg_catalog.jsonb_typeof(p_payload->'auditLogs') is distinct from 'array' then raise exception 'AUDIT_LOGS_ARRAY_INVALID' using errcode = '22023'; end if;
    if pg_catalog.jsonb_array_length(p_payload->'auditLogs') > 5000 then raise exception 'AUDIT_LOGS_ARRAY_INVALID' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_payload->'students') e(value) where pg_catalog.jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'id','') = '' or coalesce(value->>'name','') = '') then raise exception 'STUDENT_ROW_INVALID' using errcode = '22023'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_payload->'students')) <> (select count(distinct value->>'id') from pg_catalog.jsonb_array_elements(p_payload->'students')) then raise exception 'STUDENT_IDS_DUPLICATE' using errcode = '22023'; end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_payload->'paymentTypes') e(value) where pg_catalog.jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'id','') = '' or coalesce(value->>'name','') = '') then raise exception 'PAYMENT_TYPE_ROW_INVALID' using errcode = '22023'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_payload->'paymentTypes')) <> (select count(distinct value->>'id') from pg_catalog.jsonb_array_elements(p_payload->'paymentTypes')) then raise exception 'PAYMENT_TYPE_IDS_DUPLICATE' using errcode = '22023'; end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_payload->'transactions') e(value) where pg_catalog.jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'id','') = '' or coalesce(value->>'receiptNo','') = '' or coalesce(value->>'studentId','') = '' or coalesce(value->>'studentName','') = '' or coalesce(value->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or pg_catalog.jsonb_typeof(value->'items') is distinct from 'array' or coalesce(value->>'totalAmount','') !~ '^[0-9]+(\.[0-9]+)?$') then raise exception 'TRANSACTION_ROW_INVALID' using errcode = '22023'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_payload->'transactions')) <> (select count(distinct value->>'id') from pg_catalog.jsonb_array_elements(p_payload->'transactions')) then raise exception 'TRANSACTION_IDS_DUPLICATE' using errcode = '22023'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_payload->'transactions')) <> (select count(distinct value->>'receiptNo') from pg_catalog.jsonb_array_elements(p_payload->'transactions')) then raise exception 'RECEIPT_NUMBERS_DUPLICATE' using errcode = '22023'; end if;
  for v_tx in select value from pg_catalog.jsonb_array_elements(p_payload->'transactions') loop
    v_total := (v_tx->>'totalAmount')::numeric;
    if v_total < 0 then raise exception 'TRANSACTION_AMOUNT_NEGATIVE' using errcode = '22023'; end if;
    if not exists (select 1 from pg_catalog.jsonb_array_elements(p_payload->'students') s(value) where value->>'id' = v_tx->>'studentId') and coalesce(v_tx->>'studentName','') = '' then raise exception 'HISTORICAL_STUDENT_INVALID' using errcode = '22023'; end if;
    v_item_sum := 0;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_tx->'items') loop
      if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item->>'paymentTypeId','') = '' or coalesce(v_item->>'paidAmount','') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'TRANSACTION_ITEM_INVALID' using errcode = '22023'; end if;
      if (v_item->>'paidAmount')::numeric < 0 then raise exception 'TRANSACTION_ITEM_AMOUNT_NEGATIVE' using errcode = '22023'; end if;
      v_item_sum := v_item_sum + (v_item->>'paidAmount')::numeric;
    end loop;
    if pg_catalog.round(v_item_sum, 0) <> pg_catalog.round(v_total, 0) then raise exception 'TRANSACTION_TOTAL_MISMATCH' using errcode = '22023'; end if;
  end loop;
  if exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(p_payload->'auditLogs','[]'::jsonb)) e(value) where pg_catalog.jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'id','') = '' or coalesce(value->>'action','') = '' or coalesce(value->>'at','') = '') then raise exception 'AUDIT_LOG_ROW_INVALID' using errcode = '22023'; end if;
  -- Serialize writes per workspace so two devices cannot pass the revision check simultaneously.
  perform 1 from public.app_workspaces w where w.id = p_workspace_id for update;
  if not found then raise exception 'WORKSPACE_NOT_FOUND' using errcode = 'P0002'; end if;
  select s.revision into v_current from public.app_workspace_snapshots s where s.workspace_id = p_workspace_id;
  if not found then v_current := 0; end if;
  if p_expected_revision <> v_current then raise exception 'REVISION_CONFLICT: expected %, current %', p_expected_revision, v_current using errcode = '40001'; end if;
  v_next := v_current + 1;
  v_updated := pg_catalog.now();
  insert into public.app_workspace_snapshots(workspace_id, revision, payload, updated_at, updated_by)
    values (p_workspace_id, v_next, p_payload, v_updated, v_user)
    on conflict (workspace_id) do update set revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return query select v_next, v_updated;
end;
$$;

-- These RPCs intentionally run as their owner; each one validates auth.uid(),
-- membership, role, inputs, and/or revision internally. Pin search_path and restrict execute.
revoke all on function public.create_app_workspace(text) from public, anon;
revoke all on function public.create_app_workspace_invite(uuid, text, integer) from public, anon;
revoke all on function public.join_app_workspace(text) from public, anon;
revoke all on function public.save_app_workspace_snapshot(uuid, bigint, jsonb) from public, anon;
grant execute on function public.create_app_workspace(text) to authenticated;
grant execute on function public.create_app_workspace_invite(uuid, text, integer) to authenticated;
grant execute on function public.join_app_workspace(text) to authenticated;
grant execute on function public.save_app_workspace_snapshot(uuid, bigint, jsonb) to authenticated;

-- Note: applying this migration creates the secured server-side tables and RPCs.
-- It does not move old localStorage data automatically. Each device must authenticate,
-- join the same workspace, then pull the existing snapshot or perform a deliberate initial push.