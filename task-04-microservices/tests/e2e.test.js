
// Run with: node --test tests/
// Requires Docker Compose services to be running and Node.js 18+.

const test = require('node:test');
const assert = require('node:assert');

const AUTH = process.env.AUTH_URL || 'http://localhost:4001';
const ORDERS = process.env.ORDERS_URL || 'http://localhost:4002';
const NOTIFY = process.env.NOTIFY_URL || 'http://localhost:4003';

const ADMIN = {
  email: process.env.ADMIN_EMAIL || 'admin@example.com',
  password: process.env.ADMIN_PASSWORD,
};

const email = `user${Date.now()}@test.com`;
const password = 'Password123';

let userToken;
let adminToken;
let userId;
let orderId;
let asyncRequestId;
let otherUserToken;

const call = async (url, method = 'GET', body, token) => {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
  };
};

test('health checks', async () => {
  for (const u of [AUTH, ORDERS, NOTIFY]) {
    assert.strictEqual((await call(`${u}/health`)).status, 200);
  }
});

test('register validates input', async () => {
  assert.strictEqual(
    (await call(`${AUTH}/auth/register`, 'POST', {
      email: 'bad',
      password,
    })).status,
    400
  );

  assert.strictEqual(
    (await call(`${AUTH}/auth/register`, 'POST', {
      email,
      password: '123',
    })).status,
    400
  );
});

test('register + duplicate + login', async () => {
  const r = await call(`${AUTH}/auth/register`, 'POST', {
    email,
    password,
    name: 'Tester',
  });

  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.user.role, 'user');

  userId = r.body.user.id;

  assert.strictEqual(
    (await call(`${AUTH}/auth/register`, 'POST', {
      email,
      password,
    })).status,
    409
  );

  const l = await call(`${AUTH}/auth/login`, 'POST', {
    email,
    password,
  });

  assert.strictEqual(l.status, 200);
  userToken = l.body.token;

  assert.strictEqual(
    (await call(`${AUTH}/auth/login`, 'POST', {
      email,
      password: 'wrongpass1',
    })).status,
    401
  );
});

test('admin login', async () => {
  const l = await call(`${AUTH}/auth/login`, 'POST', ADMIN);

  assert.strictEqual(l.status, 200);
  adminToken = l.body.token;
});

test('JWT required and RBAC enforced on auth service', async () => {
  assert.strictEqual(
    (await call(`${AUTH}/auth/me`)).status,
    401
  );

  assert.strictEqual(
    (await call(`${AUTH}/auth/me`, 'GET', null, userToken)).status,
    200
  );

  assert.strictEqual(
    (await call(`${AUTH}/auth/users`, 'GET', null, userToken)).status,
    403
  );

  assert.strictEqual(
    (await call(`${AUTH}/auth/users`, 'GET', null, adminToken)).status,
    200
  );
});

test('orders: create, validate, list own', async () => {
  assert.strictEqual(
    (await call(`${ORDERS}/orders`, 'POST', {
      item: 'Book',
      quantity: 1,
      price: 10,
    })).status,
    401
  );

  assert.strictEqual(
    (await call(`${ORDERS}/orders`, 'POST', {
      item: '',
      quantity: 0,
      price: 1,
    }, userToken)).status,
    400
  );

  const c = await call(`${ORDERS}/orders`, 'POST', {
    item: 'Book',
    quantity: 2,
    price: 10,
  }, userToken);

  assert.strictEqual(c.status, 201);
  orderId = c.body.id;

  const list = await call(`${ORDERS}/orders`, 'GET', null, userToken);

  assert.ok(list.body.some((o) => o.id === orderId));
});

test('async order: authentication and validation', async () => {
  assert.strictEqual(
    (await call(`${ORDERS}/orders/async`, 'POST', {
      item: 'Laptop',
      quantity: 1,
      price: 500,
    })).status,
    401
  );

  assert.strictEqual(
    (await call(`${ORDERS}/orders/async`, 'POST', {
      item: '',
      quantity: 0,
      price: -1,
    }, userToken)).status,
    400
  );

  assert.strictEqual(
    (await call(`${ORDERS}/orders/requests/invalid-id`)).status,
    401
  );
});

test('async order: RabbitMQ processes request and creates order', async () => {
  const submitted = await call(`${ORDERS}/orders/async`, 'POST', {
    item: 'Async Laptop',
    quantity: 2,
    price: 750,
  }, userToken);

  assert.strictEqual(submitted.status, 202);
  assert.ok(submitted.body.requestId);

  asyncRequestId = submitted.body.requestId;

  assert.strictEqual(submitted.body.status, 'queued');

  let result;
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    result = await call(
      `${ORDERS}/orders/requests/${asyncRequestId}`,
      'GET',
      null,
      userToken
    );

    assert.strictEqual(result.status, 200);

    if (result.body.status === 'completed') {
      break;
    }

    if (result.body.status === 'failed') {
      assert.fail(`Async processing failed: ${result.body.error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  assert.ok(result, 'No request status was returned');
  assert.strictEqual(
    result.body.status,
    'completed',
    'Order request did not complete within 10 seconds'
  );

  assert.ok(result.body.order_id, 'Completed request has no order_id');

  const createdOrder = await call(
    `${ORDERS}/orders/${result.body.order_id}`,
    'GET',
    null,
    userToken
  );

  assert.strictEqual(createdOrder.status, 200);
  assert.strictEqual(createdOrder.body.item, 'Async Laptop');
  assert.strictEqual(Number(createdOrder.body.quantity), 2);
  assert.strictEqual(Number(createdOrder.body.price), 750);
});

test('async order request: ownership is enforced', async () => {
  const otherEmail = `other${Date.now()}@test.com`;

  const registered = await call(`${AUTH}/auth/register`, 'POST', {
    email: otherEmail,
    password,
    name: 'Other Tester',
  });

  assert.strictEqual(registered.status, 201);

  const login = await call(`${AUTH}/auth/login`, 'POST', {
    email: otherEmail,
    password,
  });

  assert.strictEqual(login.status, 200);
  otherUserToken = login.body.token;

  const forbidden = await call(
    `${ORDERS}/orders/requests/${asyncRequestId}`,
    'GET',
    null,
    otherUserToken
  );

  assert.strictEqual(forbidden.status, 403);

  const adminAccess = await call(
    `${ORDERS}/orders/requests/${asyncRequestId}`,
    'GET',
    null,
    adminToken
  );

  assert.strictEqual(adminAccess.status, 200);
});

test('RBAC on orders: user cannot update status or delete', async () => {
  assert.strictEqual(
    (await call(`${ORDERS}/orders/${orderId}/status`, 'PATCH', {
      status: 'shipped',
    }, userToken)).status,
    403
  );

  assert.strictEqual(
    (await call(`${ORDERS}/orders/${orderId}`, 'DELETE', null, userToken)).status,
    403
  );
});

test('admin promotes user to manager, manager updates status but cannot delete', async () => {
  const p = await call(
    `${AUTH}/auth/users/${userId}/role`,
    'PATCH',
    { role: 'manager' },
    adminToken
  );

  assert.strictEqual(p.status, 200);

  const l = await call(`${AUTH}/auth/login`, 'POST', {
    email,
    password,
  });

  const mgr = l.body.token;

  assert.strictEqual(
    (await call(`${ORDERS}/orders/${orderId}/status`, 'PATCH', {
      status: 'shipped',
    }, mgr)).status,
    200
  );

  assert.strictEqual(
    (await call(`${ORDERS}/orders/${orderId}`, 'DELETE', null, mgr)).status,
    403
  );
});

test('admin can delete order', async () => {
  assert.strictEqual(
    (await call(`${ORDERS}/orders/${orderId}`, 'DELETE', null, adminToken)).status,
    204
  );

  assert.strictEqual(
    (await call(`${ORDERS}/orders/${orderId}`, 'GET', null, adminToken)).status,
    404
  );
});

test('RabbitMQ events reached notification service', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const n = await call(`${NOTIFY}/notifications`);
  const events = n.body.map((x) => x.event);

  assert.ok(events.includes('user.registered'), 'user.registered missing');
  assert.ok(events.includes('order.created'), 'order.created missing');
});
