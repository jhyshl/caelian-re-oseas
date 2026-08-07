import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(root, 'dist', 'server');
const hostingRoot = path.join(root, 'dist', '.openai');
const statusPage = (
  await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
).replaceAll(
  'href="./',
  'href="https://jhyshl.github.io/caelian-re-oseas/',
);

const worker = `const statusPage = ${JSON.stringify(statusPage)};
const upstreamBase = 'https://jhyshl.github.io/caelian-re-oseas';
const corsHeaders = {
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const isReleasePath = (pathname) =>
  pathname.startsWith('/builds/') ||
  pathname.startsWith('/channels/') ||
  pathname.startsWith('/tavern-helper/') ||
  pathname.startsWith('/managed-content/');

const withReleaseHeaders = (request, pathname, source) => {
  const headers = new Headers(source.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }

  if (pathname.startsWith('/builds/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (
    pathname.startsWith('/channels/') ||
    pathname.startsWith('/tavern-helper/') ||
    pathname.startsWith('/managed-content/')
  ) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(request.method === 'HEAD' ? null : source.body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
};

const rebaseManifest = (manifest, origin) => {
  const rebaseUrl = (value) =>
    typeof value === 'string' && value.startsWith(upstreamBase + '/')
      ? origin + value.slice(upstreamBase.length)
      : value;
  const runtime = manifest?.modules?.runtime ?? {};
  return {
    ...manifest,
    modules: {
      ...(manifest.modules ?? {}),
      runtime: {
        ...runtime,
        url: rebaseUrl(runtime.url),
        css: (runtime.css ?? []).map((style) => ({
          ...style,
          url: rebaseUrl(style.url),
        })),
      },
    },
    ...(manifest.previous
      ? {
          previous: {
            ...manifest.previous,
            url: rebaseUrl(manifest.previous.url),
          },
        }
      : {}),
    ...(manifest.managedContent
      ? {
          managedContent: {
            ...manifest.managedContent,
            url: rebaseUrl(manifest.managedContent.url),
            ...(manifest.managedContent.sourceCard
              ? {
                  sourceCard: {
                    ...manifest.managedContent.sourceCard,
                    url: rebaseUrl(manifest.managedContent.sourceCard.url),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: {
          ...corsHeaders,
          Allow: 'GET, HEAD, OPTIONS',
        },
      });
    }

    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname;
    if (pathname === '/' || pathname === '/index.html') {
      return new Response(request.method === 'HEAD' ? null : statusPage, {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    if (
      request.method === 'GET' &&
      /^\\/channels\\/(alpha|beta)(\\.previous)?\\.json$/.test(pathname)
    ) {
      const upstreamUrl = new URL(upstreamBase + pathname);
      upstreamUrl.search = requestUrl.search;
      const upstreamResponse = await fetch(upstreamUrl, {
        redirect: 'follow',
      });
      if (!upstreamResponse.ok) {
        return withReleaseHeaders(request, pathname, upstreamResponse);
      }
      const manifest = rebaseManifest(
        await upstreamResponse.json(),
        requestUrl.origin,
      );
      return new Response(JSON.stringify(manifest, null, 2) + '\\n', {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }

    if (pathname.startsWith('/managed-content/')) {
      const upstreamUrl = new URL(upstreamBase + pathname);
      upstreamUrl.search = requestUrl.search;
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        redirect: 'follow',
      });
      return withReleaseHeaders(request, pathname, upstreamResponse);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.ok || !isReleasePath(pathname)) {
      return withReleaseHeaders(request, pathname, assetResponse);
    }

    const upstreamUrl = new URL(upstreamBase + pathname);
    upstreamUrl.search = requestUrl.search;
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      redirect: 'follow',
    });

    return withReleaseHeaders(request, pathname, upstreamResponse);
  },
};
`;

await mkdir(serverRoot, { recursive: true });
const serverEntry = path.join(serverRoot, 'index.js');
await writeFile(serverEntry, worker, 'utf8');
execFileSync(process.execPath, ['--check', serverEntry], { stdio: 'inherit' });
await mkdir(hostingRoot, { recursive: true });
await copyFile(
  path.join(root, '.openai', 'hosting.json'),
  path.join(hostingRoot, 'hosting.json'),
);
