export class HttpError extends Error {
  status: number; code: string; fields?: Record<string,string>; headers: Record<string,string>;
  constructor(status: number, code: string, message: string, fields?: Record<string,string>, headers: Record<string,string> = {}) {
    super(message); this.status=status; this.code=code; this.fields=fields; this.headers=headers;
  }
}
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers,
  } });
}
export function method(request: Request, allowed: string[]): void {
  if (!allowed.includes(request.method)) throw new HttpError(405, 'method_not_allowed', 'Método não permitido.',undefined,{Allow:allowed.join(', ')});
}
export function sameOrigin(request: Request): void {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403,'forbidden_origin','Origem não permitida.');
}
export async function body(request: Request, limit = 16000): Promise<Record<string,unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415,'content_type','Envie os dados em JSON.');
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413,'body_too_large','Requisição acima do limite permitido.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400,'invalid_json','Dados inválidos.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    if (length > limit) { await reader.cancel(); throw new HttpError(413,'body_too_large','Requisição acima do limite permitido.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string,unknown>;
  } catch { throw new HttpError(400,'invalid_json','Dados inválidos.'); }
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export async function sha256(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result),b => b.toString(16).padStart(2,'0')).join('');
}
export function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().normalize('NFC');
  const length = Array.from(clean).length; // SQLite length(TEXT) counts Unicode code points.
  return length >= min && length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean) ? clean : null;
}
