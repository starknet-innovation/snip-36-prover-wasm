// Keep remote responses bounded before parsing or persisting evidence/assets.
export async function responseBytes(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw Error("Invalid response byte limit");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing response body");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("Response exceeds byte limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function responseJson(response, maxBytes = 64 * 1024 * 1024) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await responseBytes(response, maxBytes),
    ),
  );
}
