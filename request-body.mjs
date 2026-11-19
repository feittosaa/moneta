export async function readJsonObject(request, limit = 2048) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error('Solicitação grande demais.'), { status: 413 });
    }
    chunks.push(chunk);
  }

  let body;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    body = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Objeto JSON esperado.'), { status: 400 });
  }
  return body;
}
