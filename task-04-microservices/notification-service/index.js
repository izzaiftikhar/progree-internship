const express = require('express');
const amqp = require('amqplib');
const { PORT = 4003, RABBITMQ_URL } = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retry = async (fn, name) => {
  for (let i = 0; i < 30; i++) { try { return await fn(); } catch (e) { console.log(`Waiting for ${name}...`); await sleep(2000); } }
  throw new Error(`${name} unavailable`);
};

const notifications = []; // last 100 events kept in memory
const app = express();
app.get('/health', (req, res) => res.json({ service: 'notifications', status: 'ok' }));
app.get('/notifications', (req, res) => res.json(notifications));

(async () => {
  const conn = await retry(() => amqp.connect(RABBITMQ_URL), 'rabbitmq');
  const ch = await conn.createChannel();
  await ch.assertExchange('events', 'topic', { durable: true });
  const q = await ch.assertQueue('notifications', { durable: true });
  await ch.bindQueue(q.queue, 'events', 'user.*');
  await ch.bindQueue(q.queue, 'events', 'order.*');
  ch.consume(q.queue, (msg) => {
    if (!msg) return;
    const n = { event: msg.fields.routingKey, data: JSON.parse(msg.content.toString()) };
    console.log('[notification]', JSON.stringify(n));
    notifications.unshift(n);
    if (notifications.length > 100) notifications.pop();
    ch.ack(msg);
  });
  app.listen(PORT, () => console.log(`notification-service on ${PORT}`));
})().catch((e) => { console.error(e); process.exit(1); });
