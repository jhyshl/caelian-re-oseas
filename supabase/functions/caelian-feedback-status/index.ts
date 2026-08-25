import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function environment(): { url: string; key: string } {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) throw new Error('Supabase service environment is unavailable');
  return { url, key };
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function statusResult(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.admin_status,
    author_reply: row.admin_note,
    reviewed_at: row.reviewed_at,
    resolved_at: row.resolved_at,
    updated_at: row.updated_at,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  const submissionToken = authorization.startsWith('Receipt ')
    ? authorization.slice(8).trim()
    : '';
  if (!isUuidV4(submissionToken)) {
    return json({ error: 'invalid_receipt' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const id = String(body.id ?? '');
  if (!isUuidV4(id)) return json({ error: 'invalid_feedback' }, 400);

  try {
    const { url, key } = environment();
    const select = [
      'id',
      'kind',
      'title',
      'admin_status',
      'admin_note',
      'reviewed_at',
      'resolved_at',
      'updated_at',
    ].join(',');
    const response = await fetch(
      `${url}/rest/v1/caelian_feedback?select=${select}&id=eq.${encodeURIComponent(id)}&submission_token=eq.${encodeURIComponent(submissionToken)}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Database request failed (${response.status})`);
    }
    const rows = (await response.json()) as Record<string, unknown>[];
    const current = rows[0];
    if (!current) return json({ error: 'receipt_not_found' }, 404);
    return json({ ok: true, result: statusResult(current) }, 200);
  } catch (error) {
    return json(
      {
        error: 'request_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
