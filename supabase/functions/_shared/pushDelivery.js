export function createPushHandler({ rpc, createRequest, fetchPush = fetch, now = Date.now }) {
  return async request => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const token = request.headers.get('x-safewatch-push-token');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return new Response('Unauthorized', { status: 401 });
    let batch;
    try { batch = await rpc('claim_family_sos_push', { p_token: token }); }
    catch { return new Response('Unauthorized or sender unavailable', { status: 403 }); }
    const counts = { sent: 0, retry: 0, expired: 0, cancelled: 0, failed: 0 };
    const deliver = async delivery => {
      let result = 'retry';
      let status = null;
      try {
        if (!await rpc('family_push_delivery_current', { p_id: delivery.id, p_lease: delivery.lease })) result = 'cancelled';
        else {
          const ttl = Math.max(1, Math.min(300, Math.floor((Date.parse(delivery.payload.expiresAt) - now()) / 1000)));
          const details = createRequest(delivery.subscription, JSON.stringify(delivery.payload), {
            vapidDetails: batch.vapid, TTL: ttl, urgency: 'high', topic: delivery.id.replaceAll('-', ''),
          });
          if (!/^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\//.test(details.endpoint)) throw new Error('Invalid endpoint');
          const response = await fetchPush(details.endpoint, { method: 'POST', headers: details.headers,
            body: details.body, redirect: 'error', signal: AbortSignal.timeout(8000) });
          status = response.status;
          await response.body?.cancel();
          result = response.ok ? 'sent' : [404, 410].includes(status) ? 'expired'
            : status === 429 || status >= 500 ? 'retry' : 'failed';
        }
      } catch { /* Retry without logging subscription keys or private app data. */ }
      await rpc('finish_family_sos_push', { p_id: delivery.id, p_lease: delivery.lease, p_result: result, p_status: status });
      counts[result]++;
    };
    try {
      for (let index = 0; index < batch.deliveries.length; index += 10) {
        await Promise.all(batch.deliveries.slice(index, index + 10).map(deliver));
      }
      return Response.json(counts);
    } catch { return new Response('Delivery receipt could not be saved', { status: 503 }); }
  };
}
