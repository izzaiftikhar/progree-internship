require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const presence = require('./presence');
const { logTransaction, readLogs } = require('./logger');

const CHANNELS = ['general', 'random', 'tech'];
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/channels', (req, res) => res.json(CHANNELS));
app.get('/api/active-users', async (req, res) => res.json(await presence.activeUsers()));
app.get('/api/channels/:name/users', async (req, res) => {
  if (!CHANNELS.includes(req.params.name)) return res.status(404).json({ error: 'Unknown channel' });
  res.json(await presence.channelUsers(req.params.name));
});
app.get('/api/logs', (req, res) => res.json(readLogs(Math.min(Number(req.query.limit) || 50, 500))));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Require a username on connect
io.use((socket, next) => {
  const username = String(socket.handshake.auth?.username || '').trim();
  if (!/^[\w .-]{2,30}$/.test(username)) return next(new Error('Invalid username (2-30 chars)'));
  socket.data.username = username;
  next();
});

io.on('connection', async (socket) => {
  const { username } = socket.data;
  socket.data.channels = new Set();
  await presence.userConnected(username);
  logTransaction('connect', { user: username, socketId: socket.id });
  io.emit('presence:update', await presence.activeUsers());
  socket.emit('channels', CHANNELS);

  const broadcastChannelUsers = async (channel) =>
    io.to(channel).emit('channel:users', { channel, users: await presence.channelUsers(channel) });

  socket.on('channel:join', async (channel, ack) => {
    if (!CHANNELS.includes(channel)) return ack?.({ ok: false, error: 'Unknown channel' });
    if (socket.data.channels.has(channel)) return ack?.({ ok: true });
    socket.join(channel);
    socket.data.channels.add(channel);
    await presence.joinChannel(channel, username);
    logTransaction('join', { user: username, channel });
    io.to(channel).emit('system', { channel, text: `${username} joined #${channel}`, timestamp: new Date().toISOString() });
    await broadcastChannelUsers(channel);
    ack?.({ ok: true });
  });

  socket.on('channel:leave', async (channel, ack) => {
    if (!socket.data.channels.has(channel)) return ack?.({ ok: false, error: 'Not in channel' });
    socket.leave(channel);
    socket.data.channels.delete(channel);
    await presence.leaveChannel(channel, username);
    logTransaction('leave', { user: username, channel });
    io.to(channel).emit('system', { channel, text: `${username} left #${channel}`, timestamp: new Date().toISOString() });
    await broadcastChannelUsers(channel);
    ack?.({ ok: true });
  });

  socket.on('message', (payload, ack) => {
    const channel = payload?.channel;
    const text = String(payload?.text || '').trim().slice(0, 1000);
    if (!socket.data.channels.has(channel)) return ack?.({ ok: false, error: 'Join the channel first' });
    if (!text) return ack?.({ ok: false, error: 'Empty message' });
    const entry = logTransaction('message', { user: username, channel, length: text.length });
    io.to(channel).emit('message', { channel, user: username, text, timestamp: entry.timestamp });
    ack?.({ ok: true });
  });

  socket.on('typing', (channel) => {
    if (socket.data.channels.has(channel)) socket.to(channel).emit('typing', { channel, user: username });
  });

  socket.on('disconnect', async () => {
    for (const channel of socket.data.channels) {
      await presence.leaveChannel(channel, username);
      await broadcastChannelUsers(channel);
    }
    await presence.userDisconnected(username);
    logTransaction('disconnect', { user: username, socketId: socket.id });
    io.emit('presence:update', await presence.activeUsers());
  });
});

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Realtime hub on http://localhost:${port}`));
