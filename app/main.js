const net = require("net");
const fs = require("fs");


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
  const lines = str.split("\r\n");

  if (!lines[0].startsWith("*")) {
    throw new Error("Invalid RESP Array header");
  }

  const count = parseInt(lines[0].slice(1), 10);
  const result = [];
  let i = 1;

  while (result.length < count && i < lines.length) {
    if (!lines[i].startsWith("$")) {
      throw new Error("Expected Bulk String");
    }

    const length = parseInt(lines[i].slice(1), 10);
    const value = lines[i + 1];

    if (value === undefined) {
      throw new Error("Incomplete Bulk String");
    }

    result.push(value);
    i += 2;
  }

  return result;
}

// Parse CLI arguments
const args = process.argv.slice(2);
let config = {
  dir: '',
  dbfilename: ''
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && args[i + 1]) {
    config.dir = args[i + 1];
    i++;
  } else if (args[i] === '--dbfilename' && args[i + 1]) {
    config.dbfilename = args[i + 1];
    i++;
  }
}
//Helper to read "size-encoded" values

function readSize(buffer, offset) {
  const first = buffer[offset];
  const type = first >> 6;

  if (type === 0b00) {
    // 6 bits
    return { size: first & 0x3F, nextOffset: offset + 1 };
  } else if (type === 0b01) {
    // 14 bits
    const size = ((first & 0x3F) << 8) | buffer[offset + 1];
    return { size, nextOffset: offset + 2 };
  } else if (type === 0b10) {
    // 32 bits
    const size = buffer.readUInt32BE(offset + 1);
    return { size, nextOffset: offset + 5 };
  } else {
    throw new Error("Unsupported size encoding type");
  }
}


function readString(buffer, offset) {
  const { size, nextOffset } = readSize(buffer, offset);
  const str = buffer.slice(nextOffset, nextOffset + size).toString();
  return { str, nextOffset: nextOffset + size };
}


function loadRDBFile() {
  const path = config.dir + "/" + config.dbfilename;

  if (!fs.existsSync(path)) {
    console.log("No RDB file found, starting with empty store");
    return;
  }

  console.log("Loading RDB file from", path);
  const buffer = fs.readFileSync(path);

  let offset = 0;

  // Check header: REDIS
  if (buffer.slice(0, 5).toString() !== "REDIS") {
    console.error("Invalid RDB header");
    return;
  }

  offset = 9; // skip 'REDIS' + 4 version chars

  while (offset < buffer.length) {
    const marker = buffer[offset];

    if (marker === 0xFA) {
      // metadata
      offset++;
      const metaName = readString(buffer, offset);
      offset = metaName.nextOffset;
      const metaValue = readString(buffer, offset);
      offset = metaValue.nextOffset;
    } else if (marker === 0xFE) {
      // database selector
      offset++;
      const dbIndex = readSize(buffer, offset);
      offset = dbIndex.nextOffset;
    } else if (marker === 0xFB) {
      // hash table sizes
      offset++;
      const keysInfo = readSize(buffer, offset);
      offset = keysInfo.nextOffset;
      const expiresInfo = readSize(buffer, offset);
      offset = expiresInfo.nextOffset;
    } else if (marker === 0xFC || marker === 0xFD) {
      // Expire timestamps
      if (marker === 0xFC) {
        offset += 1 + 8;
      } else {
        offset += 1 + 4;
      }
    } else if (marker === 0x00) {
      // Value type = string
      offset++;
      const key = readString(buffer, offset);
      offset = key.nextOffset;
      const value = readString(buffer, offset);
      offset = value.nextOffset;

      console.log(`Loaded key from RDB: ${key.str} -> ${value.str}`);

      store.set(key.str, { value: value.str, expiresAt: null });
    } else if (marker === 0xFF) {
      // End of file
      break;
    } else {
      console.error("Unknown marker:", marker);
      break;
    }
  }
}

loadRDBFile();




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

function serializeNullBulkString() {
  return `$-1\r\n`;
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

  case "PING": {
    return serializeSimpleString("PONG");
  }

  case "ECHO": {
    if (args.length < 2) {
      return serializeError("ERR wrong number of arguments for 'ECHO'");
    }
    return serializeBulkString(args[1]);
  }

  case "SET": {
    if (args.length < 3) {
      return serializeError("ERR wrong number of arguments for 'SET'");
    }

    const key = args[1];
    const value = args[2];
    let ttl = null;

    // Look for PX option
    for (let i = 3; i < args.length - 1; i++) {
      if (args[i].toUpperCase() === "PX") {
        ttl = parseInt(args[i + 1], 10);
      }
    }

    if (ttl !== null && (isNaN(ttl) || ttl < 0)) {
      return serializeError("ERR invalid PX value");
    }

    const record = {
      value,
      expiresAt: ttl ? Date.now() + ttl : null,
    };

    store.set(key, record);
    return serializeSimpleString("OK");
  }

 case "GET": {
  if (args.length < 2) {
    return serializeError("ERR wrong number of arguments for 'GET'");
  }

  const record = store.get(args[1]);

  if (!record) {
    return serializeNullBulkString();
  }

  if (record.expiresAt && Date.now() > record.expiresAt) {
    store.delete(args[1]);
    return serializeNullBulkString();
  }

  return serializeBulkString(record.value);
}

case "CONFIG": {
  if (args.length !== 3 || args[1].toUpperCase() !== "GET") {
    return serializeError("ERR wrong number of arguments for 'CONFIG GET'");
  }

  const param = args[2];
  let value = null;

  if (param === "dir") {
    value = config.dir;
  } else if (param === "dbfilename") {
    value = config.dbfilename;
  } else {
    value = ""; // Unknown parameters can return empty string (Redis behavior)
  }

  return `*2\r\n${serializeBulkString(param)}${serializeBulkString(value)}`;
}

case "KEYS": {
  if (args.length < 2 || args[1] !== "*") {
    return serializeError("ERR only KEYS * is supported");
  }

  const keys = Array.from(store.keys());

  let resp = `*${keys.length}\r\n`;
  for (const k of keys) {
    resp += serializeBulkString(k);
  }
  return resp;
}

    default:
      return serializeError(`ERR unknown command '${command}'`);
  }
}

// ============= SERVER SETUP =============
const server = net.createServer((connection) => {
  console.log("Client connected");

  connection.on("data", (data) => {
    try {
          console.log("RAW data received from client:", data.toString());

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
