-- Re∞: Oseas Alpha survey responses.
-- Public clients can insert one immutable response per survey-specific token.
-- They cannot read, update, or delete any response.

create table if not exists public.caelian_survey_responses (
  id uuid primary key,
  survey_id text not null
    check (
      char_length(survey_id) between 1 and 80
      and survey_id ~ '^[a-z0-9][a-z0-9._:-]*$'
    ),
  survey_revision integer not null check (survey_revision >= 1),
  survey_kind text not null check (survey_kind in ('survey', 'single')),
  submission_token uuid not null,
  answers jsonb not null
    check (
      jsonb_typeof(answers) = 'object'
      and octet_length(answers::text) <= 32768
    ),
  discord_id text
    check (discord_id is null or char_length(discord_id) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (survey_id, submission_token)
);

comment on table public.caelian_survey_responses is
  'Immutable Alpha survey answers; no chat, MVU, save, avatar, player name, fingerprint, or device metadata.';
comment on column public.caelian_survey_responses.submission_token is
  'Random token generated separately for each survey in one browser; cannot correlate different surveys.';
comment on column public.caelian_survey_responses.discord_id is
  'Optional player-provided Discord ID.';

alter table public.caelian_survey_responses enable row level security;

revoke all on table public.caelian_survey_responses from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant insert (
  id,
  survey_id,
  survey_revision,
  survey_kind,
  submission_token,
  answers,
  discord_id
) on table public.caelian_survey_responses to anon, authenticated;

drop policy if exists "caelian_survey_submit_only"
  on public.caelian_survey_responses;
create policy "caelian_survey_submit_only"
  on public.caelian_survey_responses
  for insert
  to anon, authenticated
  with check (
    char_length(survey_id) between 1 and 80
    and survey_id ~ '^[a-z0-9][a-z0-9._:-]*$'
    and survey_revision >= 1
    and survey_kind in ('survey', 'single')
    and jsonb_typeof(answers) = 'object'
    and octet_length(answers::text) <= 32768
    and (discord_id is null or char_length(discord_id) between 1 and 100)
  );

create index if not exists caelian_survey_created_at_idx
  on public.caelian_survey_responses (created_at desc);
create index if not exists caelian_survey_id_created_at_idx
  on public.caelian_survey_responses (survey_id, created_at desc);

-- Admin example:
-- select * from public.caelian_survey_responses
-- where survey_id = '<survey id>' order by created_at asc;
