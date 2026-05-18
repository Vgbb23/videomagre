import 'dotenv/config';
import express from 'express';
import { processOrderLookup, processPixCharge } from './fruitfy-handlers';

const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: '256kb' }));

app.post('/api/pix/charge', async (req, res) => {
  const result = await processPixCharge(req.body);
  res.status(result.statusCode).set(result.headers).send(result.body);
});

app.get('/api/order/:orderId', async (req, res) => {
  const result = await processOrderLookup(req.params.orderId);
  res.status(result.statusCode).set(result.headers).send(result.body);
});

app.listen(PORT, () => {
  console.log(`[fruitfy-proxy] http://127.0.0.1:${PORT}`);
});
