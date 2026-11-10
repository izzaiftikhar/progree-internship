
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

const {
  PORT = 4002,
  DATABASE_URL,
  RABBITMQ_URL,
  JWT_SECRET,
} = process.env;

const pool = new Pool({ connectionString: DATABASE_URL });

const QUEUE = 'order_requests';
const DEAD_QUEUE = 'order_requests_dead';
const DEAD_EXCHANGE = 'order_dead';
const DEAD_KEY = 'failed';
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retry = async (fn, name) => {
  for (let i = 0; i < 30; i++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`Waiting for ${name}...`);
      await sleep(2000);
    }
  }
  throw new Error(`${name} unavailable`);
};

let eventChannel;
let publisherChannel;
let consumerChannel;

const publishEvent = (key, payload) => {
  eventChannel?.publish(
    'events',
    key,
    Buffer.from(JSON.stringify({
      ...payload,
      at: new Date().toISOString(),
    })),
    { persistent: true }
  );
};

const authenticate = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (roles.includes(req.user.role)) {
    return next();
  }

  res.status(403).json({ error: 'Forbidden: insufficient role' });
};

const validateOrder = (body) => {
  const { item, quantity, price } = body || {};

  if (typeof item !== 'string' || !item.trim()) {
    return 'item is required';
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return 'quantity must be a positive integer';
  }

  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    return 'price must be a number >= 0';
  }

  return null;
};

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ service: 'orders', status: 'ok' });
});

// Existing synchronous order endpoint
app.post('/orders', authenticate, async (req, res) => {
  try {
    const validationError = validateOrder(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { item, quantity, price } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO orders(user_id, user_email, item, quantity, price)
       VALUES($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, req.user.email, item.trim(), quantity, price]
    );

    publishEvent('order.created', {
      orderId: rows[0].id,
      userEmail: req.user.email,
      item: rows[0].item,
      total: quantity * price,
    });

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Order creation failed:', error);
    res.status(500).json({ error: 'Could not create order' });
  }
});

// Submit an asynchronous order request
app.post('/orders/async', authenticate, async (req, res) => {
  try {
    const validationError = validateOrder(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { item, quantity, price } = req.body;
    const requestId = randomUUID();

    await pool.query(
      `INSERT INTO order_requests
       (request_id, user_id, user_email, item, quantity, price)
       VALUES($1, $2, $3, $4, $5, $6)`,
      [
        requestId,
        req.user.id,
        req.user.email,
        item.trim(),
        quantity,
        price,
      ]
    );

    try {
      publisherChannel.sendToQueue(
        QUEUE,
        Buffer.from(JSON.stringify({ requestId })),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: requestId,
        }
      );

      await publisherChannel.waitForConfirms();
    } catch (publishError) {
      await pool.query(
        `UPDATE order_requests
         SET status = 'failed',
             error = $2,
             updated_at = NOW()
         WHERE request_id = $1 AND status = 'queued'`,
        [requestId, 'Could not publish request to RabbitMQ']
      );

      console.error('Queue publishing failed:', publishError);

      return res.status(503).json({
        error: 'Order request could not be queued',
        requestId,
      });
    }

    res.status(202).json({
      requestId,
      status: 'queued',
      message: 'Order request accepted for processing',
    });
  } catch (error) {
    console.error('Async order submission failed:', error);
    res.status(500).json({ error: 'Could not submit order request' });
  }
});

// Check asynchronous request status
app.get('/orders/requests/:requestId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT request_id, user_id, user_email, item,
              quantity, price, status, order_id, error,
              created_at, updated_at
       FROM order_requests
       WHERE request_id = $1`,
      [req.params.requestId]
    );

    const request = rows[0];

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const privileged = ['manager', 'admin'].includes(req.user.role);

    if (!privileged && request.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(request);
  } catch (error) {
    console.error('Request lookup failed:', error);
    res.status(500).json({ error: 'Could not retrieve request' });
  }
});

// Users see their own orders; managers and admins see all
app.get('/orders', authenticate, async (req, res) => {
  try {
    const all = ['manager', 'admin'].includes(req.user.role);

    const { rows } = all
      ? await pool.query('SELECT * FROM orders ORDER BY id DESC')
      : await pool.query(
          'SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC',
          [req.user.id]
        );

    res.json(rows);
  } catch (error) {
    console.error('Order listing failed:', error);
    res.status(500).json({ error: 'Could not retrieve orders' });
  }
});

app.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE id = $1',
      [Number(req.params.id) || 0]
    );

    const order = rows[0];

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.user_id !== req.user.id && req.user.role === 'user') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(order);
  } catch (error) {
    console.error('Order lookup failed:', error);
    res.status(500).json({ error: 'Could not retrieve order' });
  }
});

// Managers and admins can update status
app.patch(
  '/orders/:id/status',
  authenticate,
  authorize('manager', 'admin'),
  async (req, res) => {
    try {
      const { status } = req.body || {};

      if (!['pending', 'shipped', 'delivered', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const { rows } = await pool.query(
        'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
        [status, Number(req.params.id) || 0]
      );

      if (!rows[0]) {
        return res.status(404).json({ error: 'Order not found' });
      }

      publishEvent('order.status_changed', {
        orderId: rows[0].id,
        status,
      });

      res.json(rows[0]);
    } catch (error) {
      console.error('Order update failed:', error);
      res.status(500).json({ error: 'Could not update order' });
    }
  }
);

// Admin only
app.delete(
  '/orders/:id',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM orders WHERE id = $1',
        [Number(req.params.id) || 0]
      );

      if (!rowCount) {
        return res.status(404).json({ error: 'Order not found' });
      }

      publishEvent('order.deleted', {
        orderId: Number(req.params.id),
      });

      res.status(204).end();
    } catch (error) {
      console.error('Order deletion failed:', error);
      res.status(500).json({ error: 'Could not delete order' });
    }
  }
);

// Process one queued request inside a short database transaction
const processOrderRequest = async (message) => {
  const data = JSON.parse(message.content.toString());

  if (!data.requestId) {
    throw new Error('Message is missing requestId');
  }

  const client = await pool.connect();
  let completedOrder = null;

  try {
    await client.query('BEGIN');

    // Lock only this request row to serialize duplicate deliveries
    const result = await client.query(
      `SELECT * FROM order_requests
       WHERE request_id = $1
       FOR UPDATE`,
      [data.requestId]
    );

    const request = result.rows[0];

    if (!request || request.status !== 'queued') {
      await client.query('COMMIT');
      return;
    }

    const inserted = await client.query(
      `INSERT INTO orders
       (user_id, user_email, item, quantity, price, source_request_id)
       VALUES($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_request_id) DO NOTHING
       RETURNING *`,
      [
        request.user_id,
        request.user_email,
        request.item,
        request.quantity,
        request.price,
        request.request_id,
      ]
    );

    if (inserted.rows[0]) {
      completedOrder = inserted.rows[0];
    } else {
      const existing = await client.query(
        'SELECT * FROM orders WHERE source_request_id = $1',
        [request.request_id]
      );

      completedOrder = existing.rows[0];
    }

    if (!completedOrder) {
      throw new Error('Could not retrieve processed order');
    }

    await client.query(
      `UPDATE order_requests
       SET status = 'completed',
           order_id = $2,
           error = NULL,
           updated_at = NOW()
       WHERE request_id = $1`,
      [request.request_id, completedOrder.id]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (completedOrder) {
    publishEvent('order.created', {
      orderId: completedOrder.id,
      userEmail: completedOrder.user_email,
      item: completedOrder.item,
      total: Number(completedOrder.quantity) * Number(completedOrder.price),
    });
  }
};

// Start RabbitMQ consumer
const startConsumer = async () => {
  consumerChannel = await (await amqp.connect(RABBITMQ_URL)).createChannel();

  await consumerChannel.assertExchange(DEAD_EXCHANGE, 'direct', {
    durable: true,
  });

  await consumerChannel.assertQueue(DEAD_QUEUE, {
    durable: true,
  });

  await consumerChannel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, DEAD_KEY);

  await consumerChannel.assertQueue(QUEUE, {
    durable: true,
    deadLetterExchange: DEAD_EXCHANGE,
    deadLetterRoutingKey: DEAD_KEY,
  });

  await consumerChannel.prefetch(10);

  await consumerChannel.consume(QUEUE, async (message) => {
    if (!message) return;

    try {
      await processOrderRequest(message);
      consumerChannel.ack(message);
    } catch (error) {
      console.error('Order request processing failed:', error);

      const retries = Number(
        message.properties.headers?.['x-retry-count'] || 0
      );

      try {
        if (retries < MAX_RETRIES) {
          publisherChannel.sendToQueue(
            QUEUE,
            message.content,
            {
              persistent: true,
              contentType: 'application/json',
              headers: {
                ...(message.properties.headers || {}),
                'x-retry-count': retries + 1,
              },
            }
          );

          await publisherChannel.waitForConfirms();
          consumerChannel.ack(message);
        } else {
          const data = JSON.parse(message.content.toString());

          if (data.requestId) {
            await pool.query(
              `UPDATE order_requests
               SET status = 'failed',
                   error = $2,
                   updated_at = NOW()
               WHERE request_id = $1 AND status = 'queued'`,
              [data.requestId, 'Maximum processing retries exceeded']
            );
          }

          consumerChannel.nack(message, false, false);
        }
      } catch (retryError) {
        console.error('Retry handling failed:', retryError);
        consumerChannel.nack(message, false, true);
      }
    }
  });

  console.log('RabbitMQ order consumer is listening');
};

(async () => {
  await retry(
    () => pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        item VARCHAR(200) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `),
    'postgres'
  );

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS source_request_id UUID
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_source_request_id_unique
    ON orders(source_request_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_requests (
      request_id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_email VARCHAR(255) NOT NULL,
      item VARCHAR(200) NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
      status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'completed', 'failed')),
      order_id INTEGER REFERENCES orders(id),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const connection = await retry(
    () => amqp.connect(RABBITMQ_URL),
    'rabbitmq'
  );

  eventChannel = await connection.createChannel();

  await eventChannel.assertExchange('events', 'topic', {
    durable: true,
  });

  publisherChannel = await connection.createConfirmChannel();

  await publisherChannel.assertQueue(QUEUE, {
    durable: true,
    deadLetterExchange: DEAD_EXCHANGE,
    deadLetterRoutingKey: DEAD_KEY,
  });

  await publisherChannel.assertExchange(DEAD_EXCHANGE, 'direct', {
    durable: true,
  });

  await publisherChannel.assertQueue(DEAD_QUEUE, {
    durable: true,
  });

  await publisherChannel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, DEAD_KEY);

  await startConsumer();

  app.listen(PORT, () => {
    console.log(`order-service on ${PORT}`);
  });
})().catch((error) => {
  console.error('Order service startup failed:', error);
  process.exit(1);
});
