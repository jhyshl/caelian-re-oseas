-- Re∞: Oseas Alpha player feedback intake.
-- Public clients can insert validated rows only. They cannot read, update, or
-- delete feedback. Processed or rejected rows are deleted from an admin
-- connection by their UUID.

create table if not exists public.caelian_feedback (
  id uuid primary key,
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
  created_at timestamptz not null default now(),
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

comment on table public.caelian_feedback is
  'Temporary Re Oseas Alpha bug reports and suggestions; delete after completion or rejection.';
comment on column public.caelian_feedback.contact is
  'Optional player-provided contact information.';
comment on column public.caelian_feedback.client_context is
  'Version-independent browser diagnostics only; never chat, MVU, or save data.';

alter table public.caelian_feedback enable row level security;

revoke all on table public.caelian_feedback from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant insert (
  id,
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

drop policy if exists "caelian_feedback_submit_only"
  on public.caelian_feedback;
create policy "caelian_feedback_submit_only"
  on public.caelian_feedback
  for insert
  to anon, authenticated
  with check (
    kind in ('bug', 'suggestion')
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

create index if not exists caelian_feedback_created_at_idx
  on public.caelian_feedback (created_at desc);

-- Admin operations:
-- select * from public.caelian_feedback order by created_at asc;
-- delete from public.caelian_feedback where id = '<feedback uuid>';
