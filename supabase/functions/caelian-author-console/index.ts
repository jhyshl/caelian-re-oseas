import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const AUTHOR_TOKEN_HASH = '4264e9438c1334a7fc858927589317839b5ca58afd1d7be19a91ab6914296efc';
const allowedOrigin = /^https:\/\/caelian-author-console\.[a-z0-9-]+\.chatgpt\.site$/i;

function cors(origin: string | null): Record<string, string> {
  const accepted =
    origin && (allowedOrigin.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin))
      ? origin
      : 'https://caelian-author-console.chatgpt.site';
  return {
    'Access-Control-Allow-Origin': accepted,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length !== 64) return false;
  const actual = await sha256(token);
  if (actual.length !== AUTHOR_TOKEN_HASH.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ AUTHOR_TOKEN_HASH.charCodeAt(index);
  }
  return difference === 0;
}

function environment(): { url: string; key: string } {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) throw new Error('Supabase service environment is unavailable');
  return { url, key };
}

async function database(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { url, key } = environment();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function dataResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Database request failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function dashboard(section: string): Promise<unknown> {
  if (section === 'card-square') {
    return dataResponse(
      await database(
        'caelian_card_square_entries?select=*&order=created_at.desc&limit=500',
      ),
    );
  }
  if (section === 'feedback') {
    return dataResponse(
      await database('caelian_feedback?select=*&order=created_at.desc&limit=500'),
    );
  }
  if (section === 'surveys') {
    return dataResponse(
      await database(
        'caelian_survey_responses?select=*&order=created_at.desc&limit=1000',
      ),
    );
  }
  throw new Error('Unknown dashboard section');
}

async function moderateEntry(body: Record<string, unknown>): Promise<unknown> {
  const id = String(body.id ?? '');
  const status = String(body.status ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid entry id');
  if (status === 'deleted') {
    return dataResponse(
      await database(`caelian_card_square_entries?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }),
    );
  }
  if (!['published', 'pending', 'rejected', 'unpublished'].includes(status)) {
    throw new Error('Invalid moderation status');
  }
  const note = String(body.note ?? '').trim().slice(0, 1000) || null;
  if (status === 'rejected' && !note) {
    throw new Error('Rejected submissions require a review note');
  }
  return dataResponse(
    await database(`caelian_card_square_entries?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status,
        review_note: note,
        reviewed_at: status === 'pending' ? null : new Date().toISOString(),
        published_at: status === 'published' ? new Date().toISOString() : null,
      }),
    }),
  );
}

async function updateFeedback(body: Record<string, unknown>): Promise<unknown> {
  const id = String(body.id ?? '');
  const status = String(body.status ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid feedback id');
  if (status === 'deleted') {
    return dataResponse(
      await database(`caelian_feedback?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }),
    );
  }
  if (!['open', 'resolved', 'rejected'].includes(status)) {
    throw new Error('Invalid feedback status');
  }
  return dataResponse(
    await database(`caelian_feedback?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        admin_status: status,
        admin_note: String(body.note ?? '').trim().slice(0, 1000) || null,
        reviewed_at: status === 'open' ? null : new Date().toISOString(),
      }),
    }),
  );
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (!(await authorized(request))) return json({ error: 'unauthorized' }, 401, origin);

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const result =
      action === 'dashboard'
        ? await dashboard(String(body.section ?? ''))
        : action === 'moderate-entry'
          ? await moderateEntry(body)
          : action === 'update-feedback'
            ? await updateFeedback(body)
            : (() => {
                throw new Error('Unknown action');
              })();
    return json({ ok: true, result }, 200, origin);
  } catch (error) {
    return json(
      {
        error: 'request_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      400,
      origin,
    );
  }
});
