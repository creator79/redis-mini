const net = require("net");

// In-memory key-value store for future SET/GET support
const store = new Map();

/**
 * Parse a RESP2-encoded request into an array of strings.
 * Supports only RESP Arrays of Bulk Strings for now.
 * 
 * Example:
 *   *2\r\n$4\r\nECHO\r\n$3\r\nhey\r\n
 *   -> ['ECHO', 'hey']
 */
function parseRESP(buffer) {
  const str = buffer.toString();
  const lines = str.split('\r\n');

  if (!lines[0].startsWith('*')) {
    throw new Error('Invalid RESP Array header');
  }

  const count = parseInt(lines[0].slice(1), 10);
  const result = [];
  let i = 1;

  while (result.length < count && i < lines.length) {
    if (!lines[i].startsWith('$')) {
      throw new Error('Expected Bulk String');
    }

    const length = parseInt(lines[i].slice(1), 10);
    const value = lines[i + 1];

    if (value === undefined) {
      throw new Error('Incomplete Bulk String');
    }

    result.push(value);
    i += 2;
  }

  return result;
}

/**
 * Serialize a simple string in RESP
 * +OK\r\n
 */
function serializeSimpleString(message) {
  return `+${message}\r\n`;
}

/**
 * Serialize a bulk string in RESP
 * $<length>\r\n<content>\r\n
 */
function serializeBulkString(message) {
  return `$${message.length}\r\n${message}\r\n`;
}

/**
 * Serialize an error in RESP
 * -<message>\r\n
 */
function serializeError(message) {
  return `-${message}\r\n`;
}

/**
 * Command handler (dispatches based on parsed command)
 * 
 * Follows Single Responsibility:
 * - Parses command name
 * - Calls appropriate implementation
 * - Returns serialized RESP response
 */
function handleCommand(args) {
  if (args.length === 0) {
    return serializeError("ERR empty command");
  }

  const command = args[0].toUpperCase();

  switch (command) {
    case 'PING':
      return serializeSimpleString("PONG");

    case 'ECHO':
      if (args.length < 2) {
        return serializeError("ERR wrong number of arguments for 'ECHO'");
      }
      return serializeBulkString(args[1]);

    case 'SET':
      if (args.length < 3) {
        return serializeError("ERR wrong number of arguments for 'SET'");
      }
      store.set(args[1], args[2]);
      return serializeSimpleString("OK");

    case 'GET':
      if (args.length < 2) {
        return serializeError("ERR wrong number of arguments for 'GET'");
      }
      const value = store.get(args[1]);
      if (value === undefined) {
        return serializeBulkString("");
      }
      return serializeBulkString(value);

    default:
      return serializeError(`ERR unknown command '${command}'`);
  }
}

// ============= SERVER SETUP =============
const server = net.createServer((connection) => {
  console.log("Client connected");

  connection.on("data", (data) => {
    try {
      const args = parseRESP(data);
      console.log("Parsed command:", args);

      const response = handleCommand(args);
      connection.write(response);

    } catch (err) {
      console.error("Error handling request:", err.message);
      connection.write(serializeError("ERR parsing error"));
    }
  });

  connection.on("end", () => {
    console.log("Client disconnected");
  });
});

server.listen(6379, "127.0.0.1", () => {
  console.log("Server listening on port 6379");
});
