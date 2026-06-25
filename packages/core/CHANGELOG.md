# Changelog

## 1.0.0

### Major Changes

- 480cfad: **Breaking:** `fromUrl()` now returns `Promise<{ body: Readable; contentType?: string }>` instead of `Promise<Readable>`.

  Callers that previously wrote:

  ```typescript
  const body = await fromUrl("https://example.com/file");
  await client.put("file", body);
  ```

  should update to:

  ```typescript
  const { body, contentType } = await fromUrl("https://example.com/file");
  await client.put("file", body, { contentType });
  ```

  The `contentType` field is populated from the `Content-Type` response header (parameters such as `; charset=utf-8` are stripped). If the server does not send a `Content-Type`, the field is `undefined`.

  Additionally, `fromUrl()` now validates the URL scheme at call time and throws immediately for non-HTTP/HTTPS URLs (e.g. `ftp://`, `file://`, `data:`).
