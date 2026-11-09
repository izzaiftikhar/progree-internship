// Redis-backed cache of active users.
const Redis = require("ioredis");

const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379"
);

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

const USERS = "presence:users";
const chanKey = (channel) => `presence:channel:${channel}`;

async function userConnected(username) {
  await redis.hincrby(USERS, username, 1);
}

async function userDisconnected(username) {
  const count = await redis.hincrby(USERS, username, -1);
  if (count <= 0) {
    await redis.hdel(USERS, username);
  }
}

async function joinChannel(channel, username) {
  await redis.hincrby(chanKey(channel), username, 1);
}

async function leaveChannel(channel, username) {
  const count = await redis.hincrby(chanKey(channel), username, -1);
  if (count <= 0) {
    await redis.hdel(chanKey(channel), username);
  }
}

const activeUsers = () => redis.hkeys(USERS);
const channelUsers = (channel) => redis.hkeys(chanKey(channel));

module.exports = {
  redis,
  userConnected,
  userDisconnected,
  joinChannel,
  leaveChannel,
  activeUsers,
  channelUsers,
};