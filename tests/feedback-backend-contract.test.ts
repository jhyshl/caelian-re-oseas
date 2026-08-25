import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  path.join(process.cwd(), 'docs', 'caelian-feedback-schema.sql'),
  'utf8',
);
const authorConsole = readFileSync(
  path.join(
    process.cwd(),
    'supabase',
    'functions',
    'caelian-author-console',
    'index.ts',
  ),
  'utf8',
);
const playerStatus = readFileSync(
  path.join(
    process.cwd(),
    'supabase',
    'functions',
    'caelian-feedback-status',
    'index.ts',
  ),
  'utf8',
);

describe('feedback backend receipt contract', () => {
  it('keeps public access insert-only and stores an unguessable receipt token', () => {
    expect(schema).toContain('submission_token uuid not null default gen_random_uuid()');
    expect(schema).toContain('create unique index if not exists caelian_feedback_submission_token_idx');
    expect(schema).toContain('revoke all on table public.caelian_feedback from anon, authenticated');
    expect(schema).not.toMatch(/grant\s+select[^;]+caelian_feedback\s+to\s+anon/is);
  });

  it('matches both feedback id and receipt token without returning the token', () => {
    expect(playerStatus).toContain("authorization.startsWith('Receipt ')");
    expect(playerStatus).toContain('&submission_token=eq.${encodeURIComponent(submissionToken)}');
    expect(playerStatus).toContain('author_reply: row.admin_note');
    const resultBody = playerStatus.slice(
      playerStatus.indexOf('function statusResult'),
      playerStatus.indexOf('Deno.serve'),
    );
    expect(resultBody).not.toContain('submission_token');
  });

  it('marks one opened item viewed and never exposes receipt tokens in dashboards', () => {
    expect(authorConsole).toContain("action === 'view-feedback'");
    expect(authorConsole).toContain('reviewed_at: current.reviewed_at ?? now');
    expect(authorConsole).toContain("status === 'resolved' ? current.resolved_at ?? now : null");
    expect(authorConsole.match(/caelian_feedback\?select=\$\{feedbackDashboardColumns\}/g)).toHaveLength(4);
    const dashboardColumns = authorConsole.slice(
      authorConsole.indexOf('const feedbackDashboardColumns'),
      authorConsole.indexOf('async function feedbackRecord'),
    );
    expect(dashboardColumns).not.toContain('submission_token');
  });
});
