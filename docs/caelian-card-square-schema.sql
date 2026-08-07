-- Caelian public card square.
-- Browser clients can read published entries and submit new immutable entries.
-- Deck builds publish immediately; custom classes and mechanisms always enter
-- the private moderation queue.

create extension if not exists pgcrypto;

create table if not exists public.caelian_card_square_entries (
  id uuid primary key,
  submission_token uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('deck_build', 'custom_class', 'mechanism')),
  status text not null check (status in ('published', 'pending', 'rejected', 'unpublished')),
  title text not null check (char_length(title) between 2 and 50),
  author_name text check (author_name is null or char_length(author_name) between 2 and 30),
  summary text not null check (char_length(summary) between 4 and 240),
  tags text[] not null default '{}',
  profession_id text not null check (char_length(profession_id) between 1 and 100),
  profession_name text not null check (char_length(profession_name) between 1 and 60),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 262144
  ),
  content_hash text generated always as (
    encode(digest(payload::text, 'sha256'), 'hex')
  ) stored,
  app_version text not null check (char_length(app_version) between 1 and 40),
  build_id text not null check (char_length(build_id) between 1 and 100),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  unique (kind, content_hash),
  check (cardinality(tags) <= 8),
  check (
    (kind = 'deck_build' and payload ->> 'format' = 'caelian_deck_build')
    or (kind = 'custom_class' and payload ->> 'format' = 'caelian_workshop_class_pack')
    or (kind = 'mechanism' and payload ->> 'format' = 'caelian_workshop_mechanism')
  )
);

alter table public.caelian_card_square_entries
  add column if not exists submission_token uuid;
update public.caelian_card_square_entries
set submission_token = gen_random_uuid()
where submission_token is null;
alter table public.caelian_card_square_entries
  alter column submission_token set default gen_random_uuid(),
  alter column submission_token set not null;
create unique index if not exists caelian_card_square_submission_token_idx
  on public.caelian_card_square_entries (submission_token);

comment on table public.caelian_card_square_entries is
  'Public Caelian deck builds plus moderated custom classes and mechanism packages.';
comment on column public.caelian_card_square_entries.author_name is
  'Optional public pen name. Null means the player selected anonymous submission.';
comment on column public.caelian_card_square_entries.payload is
  'Player-authored deck, class, or declarative mechanism JSON. Never chat, save, MVU, or player identity data.';
comment on column public.caelian_card_square_entries.submission_token is
  'Private bearer receipt used only by the submitting terminal to query moderation state.';

alter table public.caelian_card_square_entries enable row level security;
revoke all on table public.caelian_card_square_entries from anon, authenticated;
grant select (
  id, kind, status, title, author_name, summary, tags,
  profession_id, profession_name, payload, app_version, build_id,
  created_at,
  published_at
) on table public.caelian_card_square_entries to anon, authenticated;
grant insert (
  id, submission_token, kind, status, title, author_name, summary, tags,
  profession_id, profession_name, payload, app_version, build_id,
  created_at, published_at
) on table public.caelian_card_square_entries to anon, authenticated;
grant select, update, delete
  on table public.caelian_card_square_entries to service_role;

drop policy if exists "caelian_card_square_read_published"
  on public.caelian_card_square_entries;
create policy "caelian_card_square_read_published"
  on public.caelian_card_square_entries
  for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "caelian_card_square_submit"
  on public.caelian_card_square_entries;
create policy "caelian_card_square_submit"
  on public.caelian_card_square_entries
  for insert
  to anon, authenticated
  with check (
    review_note is null
    and reviewed_at is null
    and (
      (
        kind = 'deck_build'
        and status = 'published'
        and published_at is not null
        and payload ->> 'format' = 'caelian_deck_build'
      )
      or (
        kind = 'custom_class'
        and status = 'pending'
        and published_at is null
        and payload ->> 'format' = 'caelian_workshop_class_pack'
      )
      or (
        kind = 'mechanism'
        and status = 'pending'
        and published_at is null
        and payload ->> 'format' = 'caelian_workshop_mechanism'
      )
    )
  );

create index if not exists caelian_card_square_status_created_idx
  on public.caelian_card_square_entries (status, created_at desc);
create index if not exists caelian_card_square_kind_published_idx
  on public.caelian_card_square_entries (kind, published_at desc)
  where status = 'published';
create index if not exists caelian_card_square_title_idx
  on public.caelian_card_square_entries (lower(title));

alter table public.caelian_feedback
  add column if not exists admin_status text not null default 'open'
    check (admin_status in ('open', 'resolved', 'rejected')),
  add column if not exists admin_note text
    check (admin_note is null or char_length(admin_note) <= 1000),
  add column if not exists reviewed_at timestamptz;

create index if not exists caelian_feedback_status_created_idx
  on public.caelian_feedback (admin_status, created_at desc);

grant select, update, delete on table public.caelian_feedback to service_role;
grant select on table public.caelian_survey_responses to service_role;

-- Author-console review examples (the deployed console performs these through
-- its authenticated moderation function):
-- update public.caelian_card_square_entries
-- set status = 'published', reviewed_at = now(), published_at = now()
-- where id = '<entry id>' and status = 'pending';
-- update public.caelian_card_square_entries
-- set status = 'rejected', review_note = '<reason>', reviewed_at = now()
-- where id = '<entry id>' and status = 'pending';
