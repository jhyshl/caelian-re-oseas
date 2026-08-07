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

const allowedTags = new Set([
  '新手友好',
  '高难挑战',
  '爆发',
  '持续输出',
  '防御',
  '回复',
  '控制',
  '召唤',
  '资源管理',
  '抽牌',
  '弃牌',
  '状态流',
  '单体',
  '群攻',
  '低费循环',
  '机制向',
]);

function requiredText(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string {
  const normalized = String(value ?? '').trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${field}格式不正确`);
  }
  return normalized;
}

function statusResult(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    review_note: row.review_note,
    reviewed_at: row.reviewed_at,
    published_at: row.published_at,
  };
}

function editableResult(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    author_name: row.author_name,
    summary: row.summary,
    tags: row.tags,
    payload: row.payload,
  };
}

function updateFields(
  body: Record<string, unknown>,
  currentKind: unknown,
): Record<string, unknown> {
  const kind = String(body.kind ?? '');
  if (kind !== currentKind) throw new Error('修改投稿时不能更换投稿类型');
  const authorName =
    body.author_name === null
      ? null
      : requiredText(body.author_name, '作者署名', 2, 30);
  if (!Array.isArray(body.tags) || body.tags.length > 8) {
    throw new Error('搜索标签格式不正确');
  }
  const tags = [...new Set(body.tags.map((tag) => String(tag).trim()))];
  if (tags.some((tag) => !allowedTags.has(tag))) {
    throw new Error('投稿包含未开放的搜索标签');
  }
  if (
    !body.payload ||
    typeof body.payload !== 'object' ||
    Array.isArray(body.payload)
  ) {
    throw new Error('作品内容格式不正确');
  }
  const payloadText = JSON.stringify(body.payload);
  if (new TextEncoder().encode(payloadText).length > 262_144) {
    throw new Error('作品文件超过 256 KB');
  }
  return {
    title: requiredText(body.title, '作品名称', 2, 50),
    author_name: authorName,
    summary: requiredText(body.summary, '作品简介', 4, 240),
    tags,
    profession_id: requiredText(body.profession_id, '职业或机制标识', 1, 100),
    profession_name: requiredText(body.profession_name, '职业或机制名称', 1, 60),
    payload: body.payload,
    app_version: requiredText(body.app_version, '客户端版本', 1, 40),
    build_id: requiredText(body.build_id, '构建标识', 1, 100),
    status: 'pending',
    review_note: null,
    reviewed_at: null,
    published_at: null,
  };
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
    const action = String(body.action ?? 'status');
    if (!['status', 'edit', 'update'].includes(action)) {
      return json({ error: 'invalid_action' }, 400);
    }
    const response = await fetch(
      `${url}/rest/v1/caelian_card_square_entries?select=*&id=eq.${encodeURIComponent(id)}&submission_token=eq.${encodeURIComponent(receiptToken)}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    const rows = (await response.json()) as Record<string, unknown>[];
    const current = rows[0];
    if (!current) return json({ error: 'receipt_not_found' }, 404);
    if (action === 'edit') {
      return json({ ok: true, result: editableResult(current) }, 200);
    }
    if (action === 'update') {
      const patch = updateFields(body, current.kind);
      const update = await fetch(
        `${url}/rest/v1/caelian_card_square_entries?id=eq.${encodeURIComponent(id)}&submission_token=eq.${encodeURIComponent(receiptToken)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(patch),
        },
      );
      if (!update.ok) {
        throw new Error(`Database update failed (${update.status})`);
      }
      const updatedRows = (await update.json()) as Record<string, unknown>[];
      if (!updatedRows[0]) throw new Error('Database update returned no row');
      return json({ ok: true, result: statusResult(updatedRows[0]) }, 200);
    }
    return json({ ok: true, result: statusResult(current) }, 200);
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
