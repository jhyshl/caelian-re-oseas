import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadLocalAssetUrl,
  releaseLocalAssetObjectUrls,
} from '@/assets/local-asset-cache';

describe('local asset cache', () => {
  afterEach(() => {
    releaseLocalAssetObjectUrls();
    vi.restoreAllMocks();
  });

  it('stores a fetched Blob and reuses it after object URLs are released', async () => {
    const source = `/assets/test-${crypto.randomUUID()}.webp`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['asset-bytes'], { type: 'image/webp' }), {
        status: 200,
      }),
    );
    window.fetch = fetchMock as typeof fetch;
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    await expect(loadLocalAssetUrl(source, window)).resolves.toBe('blob:first');
    releaseLocalAssetObjectUrls();
    await expect(loadLocalAssetUrl(source, window)).resolves.toBe('blob:second');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('falls back to the original build URL when fetching fails', async () => {
    const source = `/assets/missing-${crypto.randomUUID()}.png`;
    window.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;

    await expect(loadLocalAssetUrl(source, window)).resolves.toBe(source);
  });
});
