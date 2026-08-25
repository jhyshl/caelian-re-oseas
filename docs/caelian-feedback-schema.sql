-- Re∞: Oseas Alpha player feedback intake and terminal receipts.
-- Public clients can insert validated rows only. Receipt state is returned by
-- the caelian-feedback-status Edge Function after matching both the row id and
-- its private submission token. Public clients never receive table read access.

create extension if not exists pgcrypto;

create table if not exists public.caelian_feedback (
  id uuid primary key,
  submission_token uuid not null default gen_random_uuid(),
  kind text not null
    check (kind in ('bug', 'suggestion')),
  title text not null
    check (char_length(title) between 4 and 120),
  details text not null
    check (char_length(details) between 10 and 4000),
  reproduction_steps text,
  expected_result text not null
    check (char_length(expected_result) between 4 and 2000),
  actual_result text,
  contact text
    check (contact is null or char_length(contact) between 1 and 160),
  app_version text not null
    check (char_length(app_version) between 1 and 40),
  build_id text not null
    check (char_length(build_id) between 1 and 100),
  client_context jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(client_context) = 'object'
      and octet_length(client_context::text) <= 4096
    ),
  admin_status text not null default 'open'
    constraint caelian_feedback_admin_status_check
    check (admin_status in ('open', 'resolved', 'rejected')),
  admin_note text
    constraint caelian_feedback_admin_note_check
    check (admin_note is null or char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (
      kind = 'bug'
      and reproduction_steps is not null
      and char_length(reproduction_steps) between 10 and 4000
      and actual_result is not null
      and char_length(actual_result) between 4 and 2000
    )
    or (
      kind = 'suggestion'
      and reproduction_steps is null
      and actual_result is null
    )
  )
);

-- Idempotent upgrade path for the intake-only schema used before receipts.
alter table public.caelian_feedback
  add column if not exists submission_token uuid,
  add column if not exists admin_status text not null default 'open',
  add column if not exists admin_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.caelian_feedback
set submission_token = gen_random_uuid()
where submission_token is null;
update public.caelian_feedback
set resolved_at = coalesce(reviewed_at, created_at, now())
where admin_status = 'resolved' and resolved_at is null;
update public.caelian_feedback
set updated_at = coalesce(resolved_at, reviewed_at, created_at, now())
where updated_at is null;

alter table public.caelian_feedback
  alter column submission_token set default gen_random_uuid(),
  alter column submission_token set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.caelian_feedback
  drop constraint if exists caelian_feedback_admin_status_check;
alter table public.caelian_feedback
  add constraint caelian_feedback_admin_status_check
  check (admin_status in ('open', 'resolved', 'rejected'));
alter table public.caelian_feedback
  drop constraint if exists caelian_feedback_admin_note_check;
alter table public.caelian_feedback
  add constraint caelian_feedback_admin_note_check
  check (admin_note is null or char_length(admin_note) <= 1000);

comment on table public.caelian_feedback is
  'Re Oseas Alpha bug reports and suggestions with persistent terminal receipts.';
comment on column public.caelian_feedback.submission_token is
  'Private bearer receipt used only by the submitting terminal to query review state.';
comment on column public.caelian_feedback.contact is
  'Optional player-provided contact information.';
comment on column public.caelian_feedback.client_context is
  'Version-independent browser diagnostics only; never chat, MVU, or save data.';
comment on column public.caelian_feedback.admin_note is
  'Optional author reply shown only through a matching private receipt.';

alter table public.caelian_feedback enable row level security;

revoke all on table public.caelian_feedback from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant insert (
  id,
  submission_token,
  kind,
  title,
  details,
  reproduction_steps,
  expected_result,
  actual_result,
  contact,
  app_version,
  build_id,
  client_context
) on table public.caelian_feedback to anon, authenticated;
grant select, update, delete on table public.caelian_feedback to service_role;

drop policy if exists "caelian_feedback_submit_only"
  on public.caelian_feedback;
create policy "caelian_feedback_submit_only"
  on public.caelian_feedback
  for insert
  to anon, authenticated
  with check (
    submission_token is not null
    and admin_status = 'open'
    and admin_note is null
    and reviewed_at is null
    and resolved_at is null
    and kind in ('bug', 'suggestion')
    and char_length(title) between 4 and 120
    and char_length(details) between 10 and 4000
    and char_length(expected_result) between 4 and 2000
    and char_length(app_version) between 1 and 40
    and char_length(build_id) between 1 and 100
    and jsonb_typeof(client_context) = 'object'
    and octet_length(client_context::text) <= 4096
    and (
      (
        kind = 'bug'
        and reproduction_steps is not null
        and char_length(reproduction_steps) between 10 and 4000
        and actual_result is not null
        and char_length(actual_result) between 4 and 2000
      )
      or (
        kind = 'suggestion'
        and reproduction_steps is null
        and actual_result is null
      )
    )
  );

create unique index if not exists caelian_feedback_submission_token_idx
  on public.caelian_feedback (submission_token);
create index if not exists caelian_feedback_created_at_idx
  on public.caelian_feedback (created_at desc);
create index if not exists caelian_feedback_status_created_idx
  on public.caelian_feedback (admin_status, created_at desc);

-- Author operations are performed through the authenticated
-- caelian-author-console Edge Function. Opening one item calls view-feedback;
-- status/reply changes call update-feedback. Player clients query only
-- caelian-feedback-status with the matching id and Receipt token.
