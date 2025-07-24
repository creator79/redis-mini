// resp.js
// Handles Redis Serialization Protocol (RESP) encoding and decoding

/**
 * RESP encoding helpers for different data types
 */
const serialize = {
  simple: (msg) => `+${msg}\r\n`,
  error: (msg) => `-${msg}\r\n`,
  bulk: (msg) => (msg == null ? `$-1\r\n` : `$${msg.length}\r\n${msg}\r\n`),
  array: (items) => `*${items.length}\r\n` + items.map(serialize.bulk).join(""),
  integer: (num) => `:${num}\r\n`,
};

/**
 * Parse RESP data into an array of command arguments
 * @param {Buffer} data - The raw data received from client
 * @returns {Array} - Array of command arguments
 */
function parseRESP(data) {
  const lines = data.toString().split("\r\n");
  if (!lines[0].startsWith("*")) throw new Error("Invalid RESP array");

  const count = parseInt(lines[0].slice(1), 10);
  const result = [];
  let i = 1;

  while (result.length < count && i < lines.length) {
    if (!lines[i].startsWith("$")) throw new Error("Expected bulk string");
    result.push(lines[i + 1]);
    i += 2;
  }

  return result;
}

module.exports = {
  serialize,
  parseRESP
};