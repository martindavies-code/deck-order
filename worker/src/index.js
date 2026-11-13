import { VerificationPipeline } from '../../server/core/pipeline.js';

/**
 * Deck Order metadata API worker.
 * Exposes the enrichment surface the static Pages client cannot serve:
 *   GET  /api/status
 *   POST /api/pipeline/verify
 * FreqBlog calls are bounded by a Durable Object monthly quota reservation
 * (every outgoing provider request reserves 1 unit, incl. queued backfill
 * collection re-requests) and cached in KV with a 30-day refresh.
 */

const MONTHLY_CAP = 1000;
const PER_IP_HOURLY_CAP = 120;
const inFlightBatches = new Map();

const ALLOWED_ORIGINS = new Set([
  'https://martindavies-code.github.io'
]);

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const maxLen = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (ab[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = isAllowedOrigin(origin) ? origin : 'https://martindavies-code.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin'
  };
}

export class QuotaCounter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7);

    // One-time/monthly seeding so the counter reflects key usage made
    // outside the worker (e.g. the pre-launch coverage trial). Guarded by
    // the worker-only ADMIN_TOKEN; never counts down, only up.
    if (url.pathname === '/set' && request.method === 'POST') {
      if (!this.env.ADMIN_TOKEN || !timingSafeEqualStrings(request.headers.get('X-Admin-Token') || '', this.env.ADMIN_TOKEN)) {
        return new Response('forbidden', { status: 403 });
      }
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }
      const { monthKey: mk, count } = body || {};
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MONTHLY_CAP * 10 || !/^\d{4}-\d{2}$/.test(mk || '')) {
        return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
      }
      const result = await this.state.storage.transaction(async () => {
        const stored = await this.state.storage.get(['month', 'monthCount']);
        let monthCount = stored.get('month') === mk ? (stored.get('monthCount') || 0) : 0;
        if (count > monthCount) {
          monthCount = count;
          await this.state.storage.put({ month: mk, monthCount });
        }
        return monthCount;
      });
      return Response.json({ ok: true, monthCount: result });
    }

    if (url.pathname !== '/reserve' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    let reserveBody;
    try { reserveBody = await request.json(); } catch {
      return Response.json({ allowed: false, error: 'invalid_json' }, { status: 400 });
    }
    const rawN = reserveBody?.n ?? 1;
    if (!Number.isInteger(rawN) || rawN < 1 || rawN > 100) {
      return Response.json({ allowed: false, error: 'invalid_reservation' }, { status: 400 });
    }
    const n = rawN;
    const ip = String(reserveBody?.ip || 'anon').slice(0, 64);
    const hourKey = now.toISOString().slice(0, 13);
    // Transaction makes check-and-increment atomic across concurrent requests.
    const outcome = await this.state.storage.transaction(async () => {
      const stored = await this.state.storage.get(['month', 'monthCount', `h:${hourKey}:${ip}`]);
      let monthCount = stored.get('month') === monthKey ? (stored.get('monthCount') || 0) : 0;
      const hourCount = stored.get(`h:${hourKey}:${ip}`) || 0;
      if (hourCount + n > PER_IP_HOURLY_CAP) {
        return { allowed: false, reason: 'per_ip_hourly_cap', remaining: Math.max(0, MONTHLY_CAP - monthCount) };
      }
      if (monthCount + n > MONTHLY_CAP) {
        return { allowed: false, reason: 'monthly_cap', remaining: 0 };
      }
      monthCount += n;
      await this.state.storage.put({
        month: monthKey,
        monthCount,
        [`h:${hourKey}:${ip}`]: hourCount + n
      });
      return { allowed: true, remaining: MONTHLY_CAP - monthCount };
    });
    return Response.json(outcome);
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return Response.json({
        success: true,
        timestamp: new Date().toISOString(),
        providers: { freqblog: { name: 'FreqBlog', isConfigured: Boolean(env.FREQBLOG_API_KEY) } }
      }, { headers: cors });
    }

    if (url.pathname === '/api/admin/quota' && request.method === 'POST') {
      // Admin-only quota seeding; no CORS header is attached on purpose.
      if (!env.ADMIN_TOKEN || !timingSafeEqualStrings(request.headers.get('X-Admin-Token') || '', env.ADMIN_TOKEN)) {
        return new Response('forbidden', { status: 403 });
      }
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }
      const quotaId = env.QUOTA.idFromName('global');
      const quotaStub = env.QUOTA.get(quotaId);
      const r = await quotaStub.fetch('https://quota.internal/set', {
        method: 'POST',
        headers: { 'X-Admin-Token': env.ADMIN_TOKEN },
        body: JSON.stringify(body)
      });
      return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/api/pipeline/verify' && request.method === 'POST') {
      if (!env.FREQBLOG_API_KEY) {
        return Response.json({ success: false, error: 'provider_not_configured' }, { status: 503, headers: cors });
      }
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ success: false, error: 'invalid_json' }, { status: 400, headers: cors });
      }
      const rawTracks = Array.isArray(body?.tracks) ? body.tracks.slice(0, 200) : [];
      const tracks = rawTracks.filter(t => t && typeof t === 'object' && !Array.isArray(t));
      if (!tracks.length) {
        return Response.json({ success: false, error: 'no_tracks' }, { status: 400, headers: cors });
      }

      // In-flight batch deduplication (singleflight) to prevent duplicate provider work and quota usage
      const batchKey = JSON.stringify(tracks.map(t => [t.artist || '', t.title || '', t.isrc || '', t.version || '']));
      if (inFlightBatches.has(batchKey)) {
        const cachedRes = await inFlightBatches.get(batchKey);
        return Response.json(cachedRes.data, { status: cachedRes.status, headers: cors });
      }

      const quotaId = env.QUOTA.idFromName('global');
      const quotaStub = env.QUOTA.get(quotaId);
      const clientIp = request.headers.get('CF-Connecting-IP') || 'anon';
      const reserveQuota = async (n) => {
        const r = await quotaStub.fetch('https://quota.internal/reserve', {
          method: 'POST',
          body: JSON.stringify({ n, ip: clientIp })
        });
        const j = await r.json();
        return Boolean(j.allowed);
      };
      const kvCache = {
        async get(k) { return env.FREQBLOG_KV.get(k, 'json'); },
        async set(k, v, ttl) { return env.FREQBLOG_KV.put(k, JSON.stringify(v), { expirationTtl: ttl }); }
      };

      const pipeline = new VerificationPipeline({
        freqblogKey: env.FREQBLOG_API_KEY,
        freqblogOptions: { cache: kvCache, reserveQuota }
      });

      const executionPromise = (async () => {
        try {
          const result = await pipeline.processPlaylist(tracks);
          return { status: 200, data: { success: true, ...result } };
        } catch (err) {
          console.error('[Worker] pipeline verify failed:', err?.message || err);
          return { status: 502, data: { success: false, error: 'pipeline_error' } };
        } finally {
          inFlightBatches.delete(batchKey);
        }
      })();

      inFlightBatches.set(batchKey, executionPromise);
      const outcome = await executionPromise;
      return Response.json(outcome.data, { status: outcome.status, headers: cors });
    }

    return new Response('not found', { status: 404, headers: cors });
  }
};
