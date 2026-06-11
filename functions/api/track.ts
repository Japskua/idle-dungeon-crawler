/**
 * Telemetry ingest: a Cloudflare Pages Function. The client POSTs small
 * batches of anonymous events; we validate hard, clamp sizes, and write one
 * D1 batch. If no DB is bound (telemetry not set up yet) we 503 and the
 * client silently shrugs.
 */
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

interface Env {
  DB?: D1Database;
}

interface PagesContext {
  request: Request & { cf?: { country?: string } };
  env: Env;
}

const MAX_EVENTS_PER_BATCH = 50;
const MAX_PAYLOAD_CHARS = 2000;

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function onRequestPost(ctx: PagesContext): Promise<Response> {
  const { request, env } = ctx;
  if (!env.DB) return new Response('telemetry not configured', { status: 503 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const installId = str(body?.installId, 64);
  const sessionId = str(body?.sessionId, 64);
  const version = str(body?.version, 32) ?? '';
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
  if (!installId || !sessionId || events.length === 0) {
    return new Response('bad batch', { status: 400 });
  }

  const country = ctx.request.cf?.country ?? request.headers.get('cf-ipcountry') ?? '';

  const stmt = env.DB.prepare(
    'INSERT INTO events (install_id, session_id, version, country, ts, type, depth, cls, value, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const rows: D1PreparedStatement[] = [];
  for (const e of events) {
    const type = str(e?.type, 32);
    const ts = num(e?.ts);
    if (!type || ts === null) continue;
    let payload: string | null = null;
    if (e?.payload && typeof e.payload === 'object') {
      try {
        payload = JSON.stringify(e.payload).slice(0, MAX_PAYLOAD_CHARS);
      } catch {
        payload = null;
      }
    }
    rows.push(
      stmt.bind(installId, sessionId, version, country, ts, type, num(e?.depth), str(e?.cls, 64), num(e?.value), payload),
    );
  }
  if (rows.length === 0) return new Response('no valid events', { status: 400 });

  try {
    await env.DB.batch(rows);
  } catch {
    return new Response('db error', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
