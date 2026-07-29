import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(root, 'dist', 'server');
const statusPage = (
  await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
).replaceAll(
  'href="./',
  'href="https://jhyshl.github.io/caelian-re-oseas/',
);

const worker = `const statusPage = ${JSON.stringify(statusPage)};
const corsHeaders = {
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const pathname = new URL(request.url).pathname;
    if (pathname === '/' || pathname === '/index.html') {
      return new Response(request.method === 'HEAD' ? null : statusPage, {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }

    if (pathname.startsWith('/builds/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (
      pathname.startsWith('/channels/') ||
      pathname.startsWith('/tavern-helper/')
    ) {
      headers.set('Cache-Control', 'no-store');
    }

    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
`;

await mkdir(serverRoot, { recursive: true });
await writeFile(path.join(serverRoot, 'index.js'), worker, 'utf8');
