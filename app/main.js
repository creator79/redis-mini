// server.js

const net = require("net");
const fs = require("fs");
const path = require("path");
const { parseHexRDB } = require("./utils");

//
// --- CONFIG PARSING ---
const args = process.argv.slice(2);
const config = { dir: ".", dbfilename: "dump.rdb" };

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir" && args[i + 1]) config.dir = args[++i];
  else if (args[i] === "--dbfilename" && args[i + 1]) config.dbfilename = args[++i];
}

//
// --- IN-MEMORY STORE ---
const store = new Map(); // key -> { value, expiresAt }

//
// --- RESP ENCODING HELPERS ---
const serialize = {
  simple: (msg) => `+${msg}\r\n`,
  error: (msg) => `-${msg}\r\n`,
  bulk: (msg) => (msg == null ? `$-1\r\n` : `$${msg.length}\r\n${msg}\r\n`),
  array: (items) => `*${items.length}\r\n` + items.map(serialize.bulk).join(""),
};

//
// --- RESP PARSER ---
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

//
// --- LOAD DATA FROM HEX-ENCODED RDB FILE ---
function loadData() {
  const fullPath = path.join(config.dir, config.dbfilename);

  if (!fs.existsSync(fullPath)) {
    console.log("No RDB file found. Starting empty.");
    return;
  }

  console.log(`Loading from ${fullPath}`);
  
  try {
    const buffer = fs.readFileSync(fullPath);
    const hexString = buffer.toString("hex");

    const pairs = parseHexRDB(hexString);
    
    pairs.forEach(({ key, value, expiresAt }) => {
      // Check if key has already expired
      if (expiresAt && Date.now() > expiresAt) {
        console.log(`Skipping expired key: ${key} (expired at ${new Date(expiresAt).toISOString()})`);
        return;
      }
      
      store.set(key, { value, expiresAt });
      const expiryInfo = expiresAt ? ` (expires at ${new Date(expiresAt).toISOString()})` : '';
      console.log(`Loaded key: ${key} -> ${value}${expiryInfo}`);
    });
    
    console.log(`Successfully loaded ${pairs.length} key-value pairs`);
    
  } catch (err) {
    console.error("Error loading RDB file:", err.message);
    console.error("Stack trace:", err.stack);
    // Continue with empty store instead of crashing
  }
}

// --- COMMAND HANDLER ---
function handleCommand(args) {
  if (args.length === 0) return serialize.error("ERR empty command");

  const cmd = args[0].toUpperCase();

  switch (cmd) {
    case "PING":
      return serialize.simple("PONG");

    case "ECHO":
      if (args.length < 2) return serialize.error("ERR wrong number of arguments for ECHO");
      return serialize.bulk(args[1]);

    case "SET": {
      if (args.length < 3) return serialize.error("ERR wrong number of arguments for SET");
      const key = args[1], value = args[2];
      let expiresAt = null;

      for (let i = 3; i < args.length - 1; i++) {
        if (args[i].toUpperCase() === "PX") {
          const px = parseInt(args[i + 1], 10);
          if (isNaN(px) || px < 0) return serialize.error("ERR invalid PX value");
          expiresAt = Date.now() + px;
        }
      }

      store.set(key, { value, expiresAt });
      return serialize.simple("OK");
    }

    case "GET": {
      if (args.length < 2) return serialize.error("ERR wrong number of arguments for GET");
      const record = store.get(args[1]);
      if (!record) return serialize.bulk(null);

      if (record.expiresAt && Date.now() > record.expiresAt) {
        store.delete(args[1]);
        return serialize.bulk(null);
      }

      return serialize.bulk(record.value);
    }

    case "CONFIG":
      if (args.length === 3 && args[1].toUpperCase() === "GET") {
        const param = args[2];
        let value = "";
        if (param === "dir") value = config.dir;
        else if (param === "dbfilename") value = config.dbfilename;
        return serialize.array([param, value]);
      }
      return serialize.error("ERR wrong CONFIG usage");

    case "KEYS":
      if (args.length === 2 && args[1] === "*") {
        // Filter out expired keys
        const validKeys = [];
        for (const [key, record] of store.entries()) {
          if (!record.expiresAt || Date.now() <= record.expiresAt) {
            validKeys.push(key);
          } else {
            store.delete(key); // Clean up expired keys
          }
        }
        return serialize.array(validKeys);
      }
      return serialize.error("ERR only KEYS * supported");

    default:
      return serialize.error(`ERR unknown command '${cmd}'`);
  }
}

//
// --- SERVER ---
loadData();

const server = net.createServer((conn) => {
  console.log("Client connected");

  conn.on("data", (data) => {
    try {
      const args = parseRESP(data);
      const response = handleCommand(args);
      conn.write(response);
    } catch (err) {
      console.error("Error:", err.message);
      conn.write(serialize.error("ERR parsing error"));
    }
  });

  conn.on("end", () => {
    console.log("Client disconnected");
  });
});

server.listen(6379, "127.0.0.1", () => {
  console.log(`Server listening on 127.0.0.1:6379`);
});