// Persistent transaction log: one JSON object per line (JSONL).
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "logs");
fs.mkdirSync(dir, { recursive: true });

const file = path.join(dir, "transactions.log");
const stream = fs.createWriteStream(file, { flags: "a" });

function logTransaction(event, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...data
  };

  stream.write(JSON.stringify(entry) + "\n");
  return entry;
}

function readLogs(limit = 50) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8").trim();
  if (!content) return [];
  const lines = content.split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line));
}

module.exports = { logTransaction, readLogs };
