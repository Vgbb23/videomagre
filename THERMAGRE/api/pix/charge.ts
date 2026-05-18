import type {VercelRequest, VercelResponse} from '@vercel/node';

/** ESM-only (package.json "type":"module" no app); `import()` evita require() no bundle CJS da Vercel. */
async function loadPixCharge() {
  const mod = await import('../../always-fit---complexo-b/server/fruitfy-handlers.js');
  return mod.processPixCharge;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.status(204).setHeader('Allow', 'POST, OPTIONS').end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST, OPTIONS').json({
      success: false,
      message: 'Method Not Allowed',
    });
    return;
  }

  const processPixCharge = await loadPixCharge();
  const result = await processPixCharge(req.body);
  for (const [k, v] of Object.entries(result.headers)) {
    if (v) res.setHeader(k, v);
  }
  res.status(result.statusCode).send(result.body);
}
