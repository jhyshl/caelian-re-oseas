import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const upstreamBase = 'https://jhyshl.github.io/caelian-re-oseas';
const proxyBase =
  'https://tlsdyacdkbcjxbwvyeim.supabase.co/functions/v1/caelian-release-proxy';
const functionMarker = '/caelian-release-proxy';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

function response(
  body: BodyInit | null,
  status: number,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      ...headers,
    },
  });
}

function resolveReleasePath(requestUrl: URL) {
  const markerIndex = requestUrl.pathname.indexOf(functionMarker);
  if (markerIndex < 0) return null;

  const relativePath = decodeURIComponent(
    requestUrl.pathname
      .slice(markerIndex + functionMarker.length)
      .replace(/^\/+/, ''),
  );
  const path = relativePath || 'channels/alpha.json';

  if (
    path.includes('..') ||
    path.includes('\\') ||
    !(
      path === 'index.html' ||
      path.startsWith('builds/') ||
      path.startsWith('channels/') ||
      path.startsWith('tavern-helper/')
    )
  ) {
    return null;
  }

  return path;
}

function rebaseManifest(manifest: Record<string, unknown>) {
  const rebaseUrl = (value: unknown) =>
    typeof value === 'string' && value.startsWith(`${upstreamBase}/`)
      ? `${proxyBase}/${value.slice(upstreamBase.length + 1)}`
      : value;
  const modules =
    typeof manifest.modules === 'object' && manifest.modules !== null
      ? (manifest.modules as Record<string, unknown>)
      : {};
  const runtime =
    typeof modules.runtime === 'object' && modules.runtime !== null
      ? (modules.runtime as Record<string, unknown>)
      : {};
  const css = Array.isArray(runtime.css)
    ? runtime.css.map((entry) => {
        const style =
          typeof entry === 'object' && entry !== null
            ? (entry as Record<string, unknown>)
            : {};
        return {
          ...style,
          url: rebaseUrl(style.url),
        };
      })
    : [];
  const previous =
    typeof manifest.previous === 'object' && manifest.previous !== null
      ? (manifest.previous as Record<string, unknown>)
      : null;

  return {
    ...manifest,
    modules: {
      ...modules,
      runtime: {
        ...runtime,
        url: rebaseUrl(runtime.url),
        css,
      },
    },
    ...(previous
      ? {
          previous: {
            ...previous,
            url: rebaseUrl(previous.url),
          },
        }
      : {}),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return response(null, 204);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response('Method not allowed', 405, {
      Allow: 'GET, HEAD, OPTIONS',
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }

  const requestUrl = new URL(request.url);
  const releasePath = resolveReleasePath(requestUrl);
  if (!releasePath) {
    return response('Not found', 404, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }

  try {
    const upstreamUrl = new URL(`${upstreamBase}/${releasePath}`);
    upstreamUrl.search = requestUrl.search;
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      redirect: 'follow',
      headers: {
        Accept: request.headers.get('Accept') ?? '*/*',
      },
    });

    if (!upstream.ok) {
      return response(
        request.method === 'HEAD' ? null : await upstream.text(),
        upstream.status,
        {
          'Cache-Control': 'no-store',
          'Content-Type':
            upstream.headers.get('Content-Type') ??
            'text/plain; charset=utf-8',
        },
      );
    }

    if (
      request.method === 'GET' &&
      /^channels\/(alpha|beta)(\.previous)?\.json$/.test(releasePath)
    ) {
      const manifest = rebaseManifest(
        (await upstream.json()) as Record<string, unknown>,
      );
      return response(`${JSON.stringify(manifest, null, 2)}\n`, 200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      });
    }

    const cacheControl = releasePath.startsWith('builds/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60, must-revalidate';
    return response(
      request.method === 'HEAD' ? null : upstream.body,
      upstream.status,
      {
        'Cache-Control': cacheControl,
        'Content-Type':
          upstream.headers.get('Content-Type') ??
          'application/octet-stream',
        ...(upstream.headers.get('ETag')
          ? { ETag: upstream.headers.get('ETag') as string }
          : {}),
      },
    );
  } catch (error) {
    return response(
      JSON.stringify({
        error: 'release_proxy_unavailable',
        message: error instanceof Error ? error.message : String(error),
      }),
      502,
      {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    );
  }
});
