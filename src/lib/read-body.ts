// Read a request body with a hard size limit, measured on the bytes actually received. A declared
// Content-Length is only a shortcut: it is checked first, but a body is cut off at the limit whatever
// it declares (or when it declares nothing, as with chunked uploads).

export type BodyBytes = { ok: true; bytes: Uint8Array } | { ok: false };

/** The body of `request` as bytes, or `{ ok: false }` when it is larger than `max` bytes. No body gives zero bytes. */
export async function readBodyBytes(request: Request, max: number): Promise<BodyBytes> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > max) return { ok: false };
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}
