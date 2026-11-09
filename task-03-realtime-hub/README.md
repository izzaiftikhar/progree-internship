# Task 3 - Concurrent WebSocket Real-Time Communication Hub

Socket.io backend with multiple channels, Redis presence cache, and persistent JSONL transaction logs.

## Run
```bash
docker compose up -d   # Redis
cp .env.example .env
npm install
npm start              # open http://localhost:4000 in two browser tabs
```

## Socket events
| Client -> Server | Description |
|---|---|
| `channel:join` (channel) | join general / random / tech |
| `channel:leave` (channel) | leave a channel |
| `message` ({channel,text}) | broadcast to channel |
| `typing` (channel) | typing indicator |

Server emits: `message`, `system`, `channel:users`, `presence:update`, `typing`, `channels`.
Connect with `io(url, { auth: { username } })`.

## REST helpers
GET /api/channels, /api/active-users, /api/channels/:name/users, /api/logs?limit=50

## Redis keys
`presence:users` (hash username->socket count), `presence:channel:<name>` (hash username->count).

## Persistent logs
`logs/transactions.log` - one JSON line per connect/join/leave/message/disconnect with ISO timestamp.
