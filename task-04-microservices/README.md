# Task 4 - Role-Based Microservice API Ecosystem

Three services, JWT auth, RBAC, RabbitMQ events, Docker Compose, automated endpoint tests.

```
client -> auth-service (4001)  --user.* events--\
       -> order-service (4002) --order.* events--> RabbitMQ (exchange "events") -> notification-service (4003)
                      \__ PostgreSQL (users, orders tables)
```

## Run
```bash
docker compose up -d --build
node --test tests/          # automated endpoint tests (Node 18+)
```
RabbitMQ UI: http://localhost:15672 (guest / guest). Seeded admin: `admin@example.com` / `Admin@12345`.

## Roles & permissions
| Endpoint | user | manager | admin |
|---|:-:|:-:|:-:|
| POST /auth/register, /auth/login | public | public | public |
| GET /auth/me | yes | yes | yes |
| GET /auth/users, PATCH /auth/users/:id/role | - | - | yes |
| POST /orders, GET /orders (own) | yes | yes (all) | yes (all) |
| PATCH /orders/:id/status | - | yes | yes |
| DELETE /orders/:id | - | - | yes |

Use header `Authorization: Bearer <token>`. Tokens expire in 1h; after a role change, log in again.

## Events (RabbitMQ topic exchange `events`)
user.registered, user.login, user.role_changed, order.created, order.status_changed, order.deleted.
View consumed events: GET http://localhost:4003/notifications

## Change secrets
Edit `JWT_SECRET`, admin credentials in docker-compose.yml before any real deployment.
m-u
