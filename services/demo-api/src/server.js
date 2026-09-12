'use strict';

const express = require('express');

const SERVICE = process.env.SERVICE_NAME || 'order';
const PORT = Number(process.env.PORT || 8080);

const app = express();
app.use(express.json());

const startedAt = Date.now();
const catalog = {
  order: {
    title: 'Order Service',
    items: [
      { id: 'ord-1001', customerId: 'cus-88', total: 42.5, status: 'paid' },
      { id: 'ord-1002', customerId: 'cus-12', total: 18.0, status: 'pending' },
    ],
  },
  customer: {
    title: 'Customer Service',
    items: [
      { id: 'cus-88', name: 'Ada Lovelace', tier: 'gold' },
      { id: 'cus-12', name: 'Grace Hopper', tier: 'silver' },
    ],
  },
  worker: {
    title: 'Worker Service',
    items: [
      { id: 'job-1', type: 'invoice-render', state: 'queued' },
      { id: 'job-2', type: 'search-reindex', state: 'running' },
    ],
  },
};

const payload = catalog[SERVICE] || catalog.order;

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: SERVICE,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  });
});

app.get('/', (_req, res) => {
  res.json({
    service: payload.title,
    environment: process.env.NODE_ENV,
    redis: process.env.REDIS_HOST || null,
    bucket: process.env.APP_BUCKET || null,
  });
});

app.get('/orders', (_req, res) => res.json({ service: SERVICE, data: catalog.order.items }));
app.get('/customers', (_req, res) => res.json({ service: SERVICE, data: catalog.customer.items }));
app.get('/worker', (_req, res) => res.json({ service: SERVICE, data: catalog.worker.items }));
app.get(`/${SERVICE}`, (_req, res) => res.json({ service: SERVICE, data: payload.items }));
app.get(`/${SERVICE}s`, (_req, res) => res.json({ service: SERVICE, data: payload.items }));

/**
 * Chaos Lab hook. `aegis chaos inject cpu-spike` calls this so Container Insights
 * records elevated CPU and the scaling remediator can fire.
 */
app.post('/chaos/cpu', (req, res) => {
  const ms = Math.min(Number(req.body?.ms || 15000), 30000);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    Math.sqrt(Math.random() * Math.random());
  }
  res.json({ burnedMs: ms, service: SERVICE });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ msg: 'listening', service: SERVICE, port: PORT }));
});
