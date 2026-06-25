import { Readable } from 'node:stream';

export interface FromUrlOptions {
  /** Abort the fetch if it hasn't completed within this many milliseconds. */
  timeoutMs?: number;
  /** Throw if the response body exceeds this many bytes. */
  maxBytes?: number;
}

export interface FromUrlResult {
  /** The response body as a Node.js Readable stream. */
  body: Readable;
  /**
   * The MIME type from the response Content-Type header, if present.
   * Parameters (e.g. "; charset=utf-8") are stripped, leaving a bare type like "image/png".
   * Pass this directly to `put()` as `{ contentType }` to avoid setting it manually.
   */
  contentType?: string;
}

export async function fromUrl(url: string | URL, opts?: FromUrlOptions): Promise<FromUrlResult> {
  const urlObj = new URL(String(url));
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    throw new Error(
      `fromUrl: unsupported URL scheme "${urlObj.protocol}". Only http: and https: are allowed.`,
    );
  }

  const controller = new AbortController();
  const timeoutId = opts?.timeoutMs !== undefined
    ? setTimeout(() => controller.abort(new Error(`fromUrl timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
    : undefined;

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error(`No body in response from ${url}`);

  const rawContentType = response.headers.get('content-type');
  const contentType: string | undefined = rawContentType ? rawContentType.split(';')[0]!.trim() : undefined;

  if (opts?.maxBytes !== undefined) {
    const cl = response.headers.get('content-length');
    if (cl !== null) {
      const length = parseInt(cl, 10);
      if (!isNaN(length) && length > opts.maxBytes) {
        throw new Error(`Response from ${String(url)} Content-Length ${length} exceeds maxBytes limit of ${opts.maxBytes}`);
      }
    }
  }

  const maxBytes = opts?.maxBytes;
  if (maxBytes === undefined) {
    return {
      body: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      ...(contentType !== undefined && { contentType }),
    };
  }

  const urlStr = String(url);
  let received = 0;
  const reader = response.body.getReader();
  const limited = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { done, value } = await reader.read();
      if (done) { ctrl.close(); return; }
      received += value.byteLength;
      if (received > maxBytes) {
        ctrl.error(new Error(`Response from ${urlStr} exceeded maxBytes limit of ${maxBytes}`));
        return;
      }
      ctrl.enqueue(value);
    },
    cancel() { reader.cancel(); },
  });

  return {
    body: Readable.fromWeb(limited as Parameters<typeof Readable.fromWeb>[0]),
    ...(contentType !== undefined && { contentType }),
  };
}
