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

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  const receiptToken = authorization.startsWith('Receipt ')
    ? authorization.slice(8).trim()
    : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptToken)) {
    return json({ error: 'invalid_receipt' }, 401);
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_entry' }, 400);
    const { url, key } = environment();
    const select = [
      'id',
      'title',
      'kind',
      'status',
      'review_note',
      'reviewed_at',
      'published_at',
    ].join(',');
    const response = await fetch(
      `${url}/rest/v1/caelian_card_square_entries?select=${select}&id=eq.${encodeURIComponent(id)}&submission_token=eq.${encodeURIComponent(receiptToken)}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    const rows = (await response.json()) as unknown[];
    if (!rows[0]) return json({ error: 'receipt_not_found' }, 404);
    return json({ ok: true, result: rows[0] }, 200);
  } catch (error) {
    return json(
      {
        error: 'request_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      400,
    );
  }
});
