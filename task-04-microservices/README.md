
# Task 4 — Role-Based Microservice API Ecosystem

A containerized microservice ecosystem featuring JWT authentication, role-based access control (RBAC), PostgreSQL persistence, asynchronous RabbitMQ messaging, and automated end-to-end testing.

## Architecture

```text
                   Client
                  /      \
                 /        \
        Auth Service    Order Service
           :4001           :4002
              |               |
              |               |
          PostgreSQL       PostgreSQL
              |               |
              |            RabbitMQ
              |          /         \
              |    Order Queue    Events Exchange
              |         |               |
              |    Order Consumer       |
              |         |               |
              |    Order Processing     |
              |                         |
              +-------------------------+
                                        |
                              Notification Service
                                      :4003
```

## Technology Stack

- Node.js and Express.js
- PostgreSQL 16
- RabbitMQ 3 with management interface
- JWT authentication
- Role-based access control
- Docker and Docker Compose
- Node.js built-in test runner

## Microservices

### 1. Auth Service — Port 4001

- User registration and login
- Password-based authentication
- JWT token generation and verification
- User role management
- Role-change and authentication events

### 2. Order Service — Port 4002

- Order creation, retrieval, updating, and deletion
- User ownership enforcement
- Manager and administrator permissions
- Asynchronous order submission
- RabbitMQ message consumption
- Transaction-based order processing
- Duplicate-processing protection
- Retry handling and dead-letter queue configuration

### 3. Notification Service — Port 4003

- Consumes RabbitMQ events
- Processes user and order events
- Provides an endpoint to retrieve notifications

## Authentication and RBAC

Supported roles:

| Permission | User | Manager | Admin |
|---|---|---|---|
| Register / Login | Yes | Yes | Yes |
| View own profile | Yes | Yes | Yes |
| View all users | No | No | Yes |
| Change user roles | No | No | Yes |
| Create orders | Yes | Yes | Yes |
| View orders | Own | All | All |
| Update order status | No | Yes | Yes |
| Delete orders | No | No | Yes |

Protected endpoints require:

`Authorization: Bearer <token>`

JWT tokens expire after one hour. Log in again after a role change to obtain an updated token.

## Asynchronous Order Processing

The asynchronous order workflow uses RabbitMQ to process order requests independently of the HTTP request.

1. The client submits an order through `POST /orders/async`.
2. The service stores a queued request in PostgreSQL.
3. The request is published to RabbitMQ.
4. The consumer processes the request.
5. PostgreSQL transaction handling ensures consistent order creation.
6. The request status is updated to completed or failed.
7. An `order.created` event is published.

The workflow also includes:

- Persistent RabbitMQ messages
- Manual message acknowledgements
- Consumer prefetch limit of 10
- Maximum of three processing retries
- Dead-letter exchange and queue
- Idempotent order creation

### Async Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/orders/async` | Submit an asynchronous order |
| GET | `/orders/requests/:requestId` | Check request processing status |

Successful submissions return HTTP 202 Accepted.

## RabbitMQ Events

The durable topic exchange `events` handles:

- `user.registered`
- `user.login`
- `user.role_changed`
- `order.created`
- `order.status_changed`
- `order.deleted`

The order-processing queues are:

- `order_requests`
- `order_requests_dead`

## API Endpoints

### Auth Service

| Method | Endpoint |
|---|---|
| GET | `/health` |
| POST | `/auth/register` |
| POST | `/auth/login` |
| GET | `/auth/me` |
| GET | `/auth/users` |
| PATCH | `/auth/users/:id/role` |

### Order Service

| Method | Endpoint |
|---|---|
| GET | `/health` |
| POST | `/orders` |
| GET | `/orders` |
| GET | `/orders/:id` |
| PATCH | `/orders/:id/status` |
| DELETE | `/orders/:id` |
| POST | `/orders/async` |
| GET | `/orders/requests/:requestId` |

### Notification Service

| Method | Endpoint |
|---|---|
| GET | `/health` |
| GET | `/notifications` |

## Setup and Execution

### Prerequisites

- Docker Engine
- Docker Compose
- Node.js 18+ if running tests directly

### Start all services

```bash
docker compose up -d --build
```

### Check service status

```bash
docker compose ps
```

### View logs

```bash
docker compose logs -f
```

### Run automated tests with local Node.js

```bash
node --test ./tests/e2e.test.js
```

### Run automated tests using a temporary Node.js container

```bash
docker run --rm \
  --network task4-microservices_default \
  -v "$PWD:/app" \
  -w /app \
  -e AUTH_URL=http://auth-service:4001 \
  -e ORDERS_URL=http://order-service:4002 \
  -e NOTIFY_URL=http://notification-service:4003 \
  node:20-alpine node --test ./tests/e2e.test.js
```

### Stop services

```bash
docker compose down
```

## Management Interfaces

RabbitMQ Management UI:

`http://localhost:15672`

Default development credentials:

- Username: `guest`
- Password: `guest`

Seeded administrator:

- Email: `admin@example.com`
- Password: `Admin@12345`

## Automated Testing

The end-to-end test suite covers:

- Service health checks
- Registration and validation
- Duplicate registration
- Login and authentication
- JWT verification
- RBAC enforcement
- Synchronous order operations
- Asynchronous order validation
- RabbitMQ order processing
- Order request ownership
- Manager and administrator permissions
- Notification event delivery

**Latest test execution:**

- Total tests: 13
- Passed: 13
- Failed: 0

## Environment and Security

Configure environment variables through Docker Compose.

Important settings include:

- `DATABASE_URL`
- `RABBITMQ_URL`
- `JWT_SECRET`
- Administrator credentials

The default credentials and secrets are intended for local development only. Replace them with secure values before deployment.

---

**Project:** Task 4 — Role-Based Microservice API Ecosystem
