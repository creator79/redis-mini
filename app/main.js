// server.js

const net = require("net");
const fs = require("fs");
const path = require("path");
const { parseHexRDB } = require("./utils");

//
// --- ENUMS AND CONSTANTS ---
const ROLES = {
  MASTER: "master",
  SLAVE: "slave"
};

const HANDSHAKE_STAGES = {
  PING: "PING",
  REPLCONF_LISTENING_PORT: "REPLCONF_LISTENING_PORT",
  REPLCONF_CAPA: "REPLCONF_CAPA",
  PSYNC: "PSYNC"
};

const COMMANDS = {
  PING: "PING",
  ECHO: "ECHO",
  SET: "SET",
  GET: "GET",
  CONFIG: "CONFIG",
  KEYS: "KEYS",
  INFO: "INFO",
  REPLCONF: "REPLCONF",
  PSYNC: "PSYNC"
};

const DEFAULT_CONFIG = {
  dir: ".",
  dbfilename: "dump.rdb",
  port: 6379,
  role: ROLES.MASTER,
  masterHost: null,
  masterPort: null,
  masterReplid: "8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb",
  masterReplOffset: 0
};

//
// --- CONFIG PARSING ---
function parseArguments() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case "--dir":
        if (i + 1 < args.length) {
          config.dir = args[++i];
        }
        break;
        
      case "--dbfilename":
        if (i + 1 < args.length) {
          config.dbfilename = args[++i];
        }
        break;
        
      case "--port":
        if (i + 1 < args.length) {
          config.port = parseInt(args[++i], 10);
        }
        break;
        
      case "--replicaof":
        if (i + 1 < args.length) {
          config.role = ROLES.SLAVE;
          const replicaofArg = args[++i];
          const parts = replicaofArg.split(" ");
          if (parts.length === 2) {
            config.masterHost = parts[0];
            config.masterPort = parseInt(parts[1], 10);
          }
        }
        break;
    }
  }

  return config;
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
// --- REPLICA HANDSHAKE ---
class ReplicaHandshake {
  constructor(config) {
    this.config = config;
    this.currentStage = HANDSHAKE_STAGES.PING;
    this.connection = null;
  }

  async start() {
    if (this.config.role !== ROLES.SLAVE) {
      console.log("Not a slave, skipping handshake");
      return;
    }

    console.log(`Starting handshake with master at ${this.config.masterHost}:${this.config.masterPort}`);
    
    try {
      await this.connectToMaster();
      await this.executeHandshake();
    } catch (error) {
      console.error("Handshake failed:", error.message);
      if (this.connection) {
        this.connection.destroy();
      }
    }
  }

  connectToMaster() {
    return new Promise((resolve, reject) => {
      this.connection = net.createConnection(
        this.config.masterPort,
        this.config.masterHost,
        () => {
          console.log("Connected to master");
          resolve();
        }
      );

      this.connection.on('error', (error) => {
        console.error("Connection error:", error.message);
        reject(error);
      });

      this.connection.on('data', (data) => {
        this.handleMasterResponse(data);
      });

      this.connection.on('close', () => {
        console.log("Connection to master closed");
      });
    });
  }

  async executeHandshake() {
    await this.sendPing();
    await this.sendReplconfListeningPort();
    await this.sendReplconfCapa();
    await this.sendPsync();
    console.log("Handshake completed successfully");
  }

  sendPing() {
    console.log("Sending PING to master");
    const command = serialize.array([COMMANDS.PING]);
    this.connection.write(command);
    this.currentStage = HANDSHAKE_STAGES.PING;
  }

  sendReplconfListeningPort() {
    console.log("Sending REPLCONF listening-port to master");
    const command = serialize.array([COMMANDS.REPLCONF, "listening-port", this.config.port.toString()]);
    this.connection.write(command);
    this.currentStage = HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT;
  }

  sendReplconfCapa() {
    console.log("Sending REPLCONF capa to master");
    const command = serialize.array([COMMANDS.REPLCONF, "capa", "psync2"]);
    this.connection.write(command);
    this.currentStage = HANDSHAKE_STAGES.REPLCONF_CAPA;
  }

  sendPsync() {
    console.log("Sending PSYNC to master");
    const command = serialize.array([COMMANDS.PSYNC, "?", "-1"]);
    this.connection.write(command);
    this.currentStage = HANDSHAKE_STAGES.PSYNC;
  }

  handleMasterResponse(data) {
    const response = data.toString();
    console.log(`Received from master (${this.currentStage}):`, response.trim());

    switch (this.currentStage) {
      case HANDSHAKE_STAGES.PING:
        if (response.includes("PONG")) {
          this.sendReplconfListeningPort();
        }
        break;

      case HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT:
        if (response.includes("OK")) {
          this.sendReplconfCapa();
        }
        break;

      case HANDSHAKE_STAGES.REPLCONF_CAPA:
        if (response.includes("OK")) {
          this.sendPsync();
        }
        break;

      case HANDSHAKE_STAGES.PSYNC:
        if (response.includes("FULLRESYNC")) {
          console.log("Full resync initiated");
          // TODO: Handle RDB file reception in future stages
        }
        break;
    }
  }
}

//
// --- LOAD DATA FROM HEX-ENCODED RDB FILE ---
function loadData(config) {
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
      if (expiresAt && Date.now() > expiresAt) {
        console.log(`Skipping expired key: ${key} (expired at ${new Date(expiresAt).toISOString()})`);
        return;
      }

      store.set(key, { value, expiresAt });
      const expiryInfo = expiresAt ? ` (expires at ${new Date(expiresAt).toISOString()})` : "";
      console.log(`Loaded key: ${key} -> ${value}${expiryInfo}`);
    });

    console.log(`Successfully loaded ${pairs.length} key-value pairs`);
  } catch (err) {
    console.error("Error loading RDB file:", err.message);
    console.error("Stack trace:", err.stack);
  }
}

//
// --- COMMAND HANDLERS ---
class CommandHandler {
  constructor(config) {
    this.config = config;
  }

  handle(args) {
    if (args.length === 0) return serialize.error("ERR empty command");

    const cmd = args[0].toUpperCase();

    switch (cmd) {
      case COMMANDS.PING:
        return this.handlePing(args);
      case COMMANDS.ECHO:
        return this.handleEcho(args);
      case COMMANDS.SET:
        return this.handleSet(args);
      case COMMANDS.GET:
        return this.handleGet(args);
      case COMMANDS.CONFIG:
        return this.handleConfig(args);
      case COMMANDS.KEYS:
        return this.handleKeys(args);
      case COMMANDS.INFO:
        return this.handleInfo(args);
      case COMMANDS.REPLCONF:
        return this.handleReplconf(args);
      case COMMANDS.PSYNC:
        return this.handlePsync(args);
      default:
        return serialize.error(`ERR unknown command '${cmd}'`);
    }
  }

  handlePing(args) {
    return serialize.simple("PONG");
  }

  handleEcho(args) {
    if (args.length < 2) {
      return serialize.error("ERR wrong number of arguments for ECHO");
    }
    return serialize.bulk(args[1]);
  }

  handleSet(args) {
    if (args.length < 3) {
      return serialize.error("ERR wrong number of arguments for SET");
    }

    const key = args[1];
    const value = args[2];
    let expiresAt = null;

    for (let i = 3; i < args.length - 1; i++) {
      if (args[i].toUpperCase() === "PX") {
        const px = parseInt(args[i + 1], 10);
        if (isNaN(px) || px < 0) {
          return serialize.error("ERR invalid PX value");
        }
        expiresAt = Date.now() + px;
      }
    }

    store.set(key, { value, expiresAt });
    return serialize.simple("OK");
  }

  handleGet(args) {
    if (args.length < 2) {
      return serialize.error("ERR wrong number of arguments for GET");
    }

    const record = store.get(args[1]);
    if (!record) return serialize.bulk(null);

    if (record.expiresAt && Date.now() > record.expiresAt) {
      store.delete(args[1]);
      return serialize.bulk(null);
    }

    return serialize.bulk(record.value);
  }

  handleConfig(args) {
    if (args.length === 3 && args[1].toUpperCase() === "GET") {
      const param = args[2];
      let value = "";
      
      if (param === "dir") {
        value = this.config.dir;
      } else if (param === "dbfilename") {
        value = this.config.dbfilename;
      }
      
      return serialize.array([param, value]);
    }
    return serialize.error("ERR wrong CONFIG usage");
  }

  handleKeys(args) {
    if (args.length === 2 && args[1] === "*") {
      const validKeys = [];
      for (const [key, record] of store.entries()) {
        if (!record.expiresAt || Date.now() <= record.expiresAt) {
          validKeys.push(key);
        } else {
          store.delete(key);
        }
      }
      return serialize.array(validKeys);
    }
    return serialize.error("ERR only KEYS * supported");
  }

  handleInfo(args) {
    if (args.length === 2 && args[1].toLowerCase() === "replication") {
      const infoLines = [`role:${this.config.role}`];
      
      if (this.config.role === ROLES.MASTER) {
        infoLines.push(`master_replid:${this.config.masterReplid}`);
        infoLines.push(`master_repl_offset:${this.config.masterReplOffset}`);
      }
      
      return serialize.bulk(infoLines.join("\r\n"));
    }
    return serialize.error("ERR only INFO replication supported for now");
  }

  handleReplconf(args) {
    // Master receives REPLCONF from replicas during handshake
    return serialize.simple("OK");
  }

  handlePsync(args) {
    // Master receives PSYNC from replicas during handshake
    // For now, just acknowledge - full implementation in later stages
    return serialize.simple(`FULLRESYNC ${this.config.masterReplid} ${this.config.masterReplOffset}`);
  }
}

//
// --- MAIN SERVER ---
async function main() {
  const config = parseArguments();
  console.log("Parsed config:", config);

  // Load data from RDB file
  loadData(config);

  // Create command handler
  const commandHandler = new CommandHandler(config);

  // Start replica handshake if this is a slave
  if (config.role === ROLES.SLAVE) {
    const handshake = new ReplicaHandshake(config);
    // Start handshake in background
    setImmediate(() => handshake.start());
  }

  // Start server
  const server = net.createServer((conn) => {
    console.log("Client connected");

    conn.on("data", (data) => {
      try {
        const args = parseRESP(data);
        const response = commandHandler.handle(args);
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

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Server listening on 127.0.0.1:${config.port}`);
  });
}

// Start the server
main().catch(console.error);