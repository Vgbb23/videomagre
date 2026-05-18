import type {VercelRequest, VercelResponse} from '@vercel/node';

async function loadOrderLookup() {
  const mod = await import('../../always-fit---complexo-b/server/fruitfy-handlers.js');
  return mod.processOrderLookup;
}

function singleQuery(q: string | string[] | undefined): string | undefined {
  if (q == null) return undefined;
  return Array.isArray(q) ? q[0] : q;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.status(204).setHeader('Allow', 'GET, OPTIONS').end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).setHeader('Allow', 'GET, OPTIONS').json({
      success: false,
      message: 'Method Not Allowed',
    });
    return;
  }

  const processOrderLookup = await loadOrderLookup();
  const orderId = singleQuery(req.query.orderId);
  const result = await processOrderLookup(orderId);
  for (const [k, v] of Object.entries(result.headers)) {
    if (v) res.setHeader(k, v);
  }
  res.status(result.statusCode).send(result.body);
}
