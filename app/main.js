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
  PSYNC: "PSYNC",
  COMPLETED: "COMPLETED"
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
  PSYNC: "PSYNC",
  WAIT: "WAIT"
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
  integer: (num) => `:${num}\r\n`,
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
// --- REPLICA MANAGEMENT ---
class ReplicaManager {
  constructor() {
    this.replicas = new Map(); // connection -> { offset, lastAck, connection }
    this.masterOffset = 0;
    this.waitingCommands = new Map(); // commandId -> { requiredReplicas, timeout, resolve, reject }
  }

  addReplica(connection) {
    const replica = {
      offset: 0,
      lastAck: Date.now(),
      connection: connection
    };
    this.replicas.set(connection, replica);
    console.log(`Added replica. Total replicas: ${this.replicas.size}`);
  }

  removeReplica(connection) {
    this.replicas.delete(connection);
    console.log(`Removed replica. Total replicas: ${this.replicas.size}`);
  }

  propagateCommand(command, commandBytes) {
    if (this.replicas.size === 0) return;

    console.log(`Propagating command to ${this.replicas.size} replicas:`, command);
    
    // Update master offset
    this.masterOffset += commandBytes;
    
    // Send command to all replicas
    for (const [connection, replica] of this.replicas) {
      try {
        connection.write(command);
        console.log(`Sent command to replica`);
      } catch (error) {
        console.error(`Error sending to replica:`, error.message);
        this.removeReplica(connection);
      }
    }
  }

  updateReplicaOffset(connection, offset) {
    const replica = this.replicas.get(connection);
    if (replica) {
      replica.offset = offset;
      replica.lastAck = Date.now();
      console.log(`Updated replica offset to ${offset}`);
      
      // Check if any WAIT commands can be resolved
      this.checkWaitingCommands();
    }
  }

  getReplicaCount() {
    return this.replicas.size;
  }

  getReplicasAtOffset(targetOffset) {
    let count = 0;
    for (const [connection, replica] of this.replicas) {
      if (replica.offset >= targetOffset) {
        count++;
      }
    }
    return count;
  }

  waitForReplicas(numReplicas, timeout) {
    return new Promise((resolve, reject) => {
      const currentOffset = this.masterOffset;
      const replicasAtOffset = this.getReplicasAtOffset(currentOffset);
      
      console.log(`WAIT: Need ${numReplicas} replicas at offset ${currentOffset}, currently have ${replicasAtOffset}`);
      
      // If we already have enough replicas at the current offset, resolve immediately
      if (replicasAtOffset >= numReplicas) {
        console.log(`WAIT: Already have enough replicas`);
        resolve(replicasAtOffset);
        return;
      }
      
      // If we have no replicas, resolve with 0
      if (this.replicas.size === 0) {
        console.log(`WAIT: No replicas connected`);
        resolve(0);
        return;
      }
      
      // Send REPLCONF GETACK to all replicas to get their current offset
      const getackCommand = serialize.array([COMMANDS.REPLCONF, "GETACK", "*"]);
      for (const [connection, replica] of this.replicas) {
        try {
          connection.write(getackCommand);
          console.log(`Sent GETACK to replica`);
        } catch (error) {
          console.error(`Error sending GETACK to replica:`, error.message);
          this.removeReplica(connection);
        }
      }
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const finalCount = this.getReplicasAtOffset(currentOffset);
        console.log(`WAIT: Timeout reached, returning ${finalCount} replicas`);
        resolve(finalCount);
      }, timeout);
      
      // Store the wait command
      const commandId = Date.now() + Math.random();
      this.waitingCommands.set(commandId, {
        requiredReplicas: numReplicas,
        targetOffset: currentOffset,
        timeout: timeoutId,
        resolve: (count) => {
          clearTimeout(timeoutId);
          this.waitingCommands.delete(commandId);
          resolve(count);
        }
      });
    });
  }

  checkWaitingCommands() {
    for (const [commandId, waitCmd] of this.waitingCommands) {
      const replicasAtOffset = this.getReplicasAtOffset(waitCmd.targetOffset);
      console.log(`Checking WAIT command: need ${waitCmd.requiredReplicas}, have ${replicasAtOffset} at offset ${waitCmd.targetOffset}`);
      
      if (replicasAtOffset >= waitCmd.requiredReplicas) {
        console.log(`WAIT command satisfied with ${replicasAtOffset} replicas`);
        waitCmd.resolve(replicasAtOffset);
      }
    }
  }

  getMasterOffset() {
    return this.masterOffset;
  }
}

//
// --- REPLICA HANDSHAKE ---
class ReplicaHandshake {
  constructor(config) {
    this.config = config;
    this.currentStage = HANDSHAKE_STAGES.PING;
    this.connection = null;
    this.pendingResolve = null;
    this.buffer = '';
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
        this.buffer += data.toString();
        this.handleMasterResponse();
      });

      this.connection.on('close', () => {
        console.log("Connection to master closed");
      });
    });
  }

  async executeHandshake() {
    console.log("Starting handshake sequence");
    
    // Step 1: PING
    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.PING);
    
    // Step 2: REPLCONF listening-port
    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT);
    
    // Step 3: REPLCONF capa
    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.REPLCONF_CAPA);
    
    // Step 4: PSYNC
    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.PSYNC);
    
    console.log("Handshake completed successfully");
    this.currentStage = HANDSHAKE_STAGES.COMPLETED;
  }

  sendCommandAndWaitForResponse(stage) {
    return new Promise((resolve, reject) => {
      this.currentStage = stage;
      this.pendingResolve = resolve;
      
      switch (stage) {
        case HANDSHAKE_STAGES.PING:
          this.sendPing();
          break;
        case HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT:
          this.sendReplconfListeningPort();
          break;
        case HANDSHAKE_STAGES.REPLCONF_CAPA:
          this.sendReplconfCapa();
          break;
        case HANDSHAKE_STAGES.PSYNC:
          this.sendPsync();
          break;
        default:
          reject(new Error(`Unknown stage: ${stage}`));
      }
      
      // Set a timeout to avoid hanging
      setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          reject(new Error(`Timeout waiting for response in stage: ${stage}`));
        }
      }, 5000);
    });
  }

  sendPing() {
    console.log("Sending PING to master");
    const command = serialize.array([COMMANDS.PING]);
    this.connection.write(command);
  }

  sendReplconfListeningPort() {
    console.log("Sending REPLCONF listening-port to master");
    const command = serialize.array([COMMANDS.REPLCONF, "listening-port", this.config.port.toString()]);
    this.connection.write(command);
  }

  sendReplconfCapa() {
    console.log("Sending REPLCONF capa to master");
    const command = serialize.array([COMMANDS.REPLCONF, "capa", "psync2"]);
    this.connection.write(command);
  }

  sendPsync() {
    console.log("Sending PSYNC to master");
    const command = serialize.array([COMMANDS.PSYNC, "?", "-1"]);
    this.connection.write(command);
  }

  handleMasterResponse() {
    // Process complete responses from the buffer
    while (this.buffer.includes('\r\n')) {
      let responseEnd = this.buffer.indexOf('\r\n');
      let response = this.buffer.substring(0, responseEnd + 2);
      this.buffer = this.buffer.substring(responseEnd + 2);
      
      console.log(`Received from master (${this.currentStage}):`, response.trim());
      
      switch (this.currentStage) {
        case HANDSHAKE_STAGES.PING:
          if (response.includes("PONG")) {
            if (this.pendingResolve) {
              this.pendingResolve();
              this.pendingResolve = null;
            }
          }
          break;

        case HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT:
          if (response.includes("OK")) {
            if (this.pendingResolve) {
              this.pendingResolve();
              this.pendingResolve = null;
            }
          }
          break;

        case HANDSHAKE_STAGES.REPLCONF_CAPA:
          if (response.includes("OK")) {
            if (this.pendingResolve) {
              this.pendingResolve();
              this.pendingResolve = null;
            }
          }
          break;

        case HANDSHAKE_STAGES.PSYNC:
          if (response.includes("FULLRESYNC")) {
            console.log("Full resync initiated");
            if (this.pendingResolve) {
              this.pendingResolve();
              this.pendingResolve = null;
            }
            // TODO: Handle RDB file reception in future stages
          }
          break;
      }
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
  constructor(config, replicaManager) {
    this.config = config;
    this.replicaManager = replicaManager;
  }

  handle(args, connection = null) {
    if (args.length === 0) return serialize.error("ERR empty command");

    const cmd = args[0].toUpperCase();

    switch (cmd) {
      case COMMANDS.PING:
        return this.handlePing(args);
      case COMMANDS.ECHO:
        return this.handleEcho(args);
      case COMMANDS.SET:
        return this.handleSet(args, connection);
      case COMMANDS.GET:
        return this.handleGet(args);
      case COMMANDS.CONFIG:
        return this.handleConfig(args);
      case COMMANDS.KEYS:
        return this.handleKeys(args);
      case COMMANDS.INFO:
        return this.handleInfo(args);
      case COMMANDS.REPLCONF:
        return this.handleReplconf(args, connection);
      case COMMANDS.PSYNC:
        return this.handlePsync(args, connection);
      case COMMANDS.WAIT:
        return this.handleWait(args);
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

  handleSet(args, connection) {
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
    
    // Propagate to replicas if this is a master
    if (this.config.role === ROLES.MASTER) {
      const command = serialize.array(args);
      const commandBytes = Buffer.byteLength(command);
      this.replicaManager.propagateCommand(command, commandBytes);
    }

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
        infoLines.push(`master_repl_offset:${this.replicaManager.getMasterOffset()}`);
      }
      
      return serialize.bulk(infoLines.join("\r\n"));
    }
    return serialize.error("ERR only INFO replication supported for now");
  }

  handleReplconf(args, connection) {
    if (args.length < 2) {
      return serialize.error("ERR wrong number of arguments for REPLCONF");
    }

    const subcommand = args[1].toUpperCase();
    
    switch (subcommand) {
      case "LISTENING-PORT":
        // During handshake - just acknowledge
        return serialize.simple("OK");
        
      case "CAPA":
        // During handshake - just acknowledge
        return serialize.simple("OK");
        
      case "ACK":
        // Replica is acknowledging receipt of commands
        if (args.length >= 3) {
          const offset = parseInt(args[2], 10);
          if (!isNaN(offset) && connection) {
            console.log(`Received ACK from replica with offset ${offset}`);
            this.replicaManager.updateReplicaOffset(connection, offset);
          }
        }
        // Don't send a response for ACK
        return null;
        
      case "GETACK":
        // Master is asking for current offset - this should be handled by replica
        // For now, just return current offset (slaves don't track offset in this implementation)
        return serialize.array([COMMANDS.REPLCONF, "ACK", "0"]);
        
      default:
        return serialize.simple("OK");
    }
  }

  handlePsync(args, connection) {
    if (this.config.role !== ROLES.MASTER) {
      return serialize.error("ERR PSYNC can only be sent to master");
    }

    // Add this connection as a replica
    if (connection) {
      this.replicaManager.addReplica(connection);
    }

    // Send FULLRESYNC response
    const response = serialize.simple(`FULLRESYNC ${this.config.masterReplid} ${this.replicaManager.getMasterOffset()}`);
    
    // Send empty RDB file after FULLRESYNC
    if (connection) {
      setImmediate(() => {
        // Send empty RDB file (just the header)
        const emptyRdb = Buffer.from("524544495330303131fa0972656469732d76657205372e322e30fa0a72656469732d62697473c040fa056374696d65c26d08bc65fa08757365642d6d656dc2b0c41000fa08616f662d62617365c000fff06e3bfec0ff5aa2", "hex");
        connection.write(`$${emptyRdb.length}\r\n`);
        connection.write(emptyRdb);
      });
    }
    
    return response;
  }

  async handleWait(args) {
    if (args.length < 3) {
      return serialize.error("ERR wrong number of arguments for WAIT");
    }

    const numReplicas = parseInt(args[1], 10);
    const timeout = parseInt(args[2], 10);

    if (isNaN(numReplicas) || isNaN(timeout)) {
      return serialize.error("ERR invalid arguments for WAIT");
    }

    if (this.config.role !== ROLES.MASTER) {
      return serialize.error("ERR WAIT can only be sent to master");
    }

    console.log(`WAIT command: waiting for ${numReplicas} replicas with timeout ${timeout}ms`);

    try {
      const count = await this.replicaManager.waitForReplicas(numReplicas, timeout);
      return serialize.integer(count);
    } catch (error) {
      console.error("Error in WAIT command:", error.message);
      return serialize.error("ERR WAIT command failed");
    }
  }
}

//
// --- MAIN SERVER ---
async function main() {
  const config = parseArguments();
  console.log("Parsed config:", config);

  // Load data from RDB file
  loadData(config);

  // Create replica manager (only used by master)
  const replicaManager = new ReplicaManager();

  // Create command handler
  const commandHandler = new CommandHandler(config, replicaManager);

  // Start server first
  const server = net.createServer((conn) => {
    console.log("Client connected");

    conn.on("data", async (data) => {
      try {
        const args = parseRESP(data);
        const response = await commandHandler.handle(args, conn);
        
        if (response !== null) {
          conn.write(response);
        }
      } catch (err) {
        console.error("Error:", err.message);
        conn.write(serialize.error("ERR parsing error"));
      }
    });

    conn.on("end", () => {
      console.log("Client disconnected");
      // Remove from replicas if it was one
      if (config.role === ROLES.MASTER) {
        replicaManager.removeReplica(conn);
      }
    });

    conn.on("error", (err) => {
      console.error("Connection error:", err.message);
      if (config.role === ROLES.MASTER) {
        replicaManager.removeReplica(conn);
      }
    });
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Server listening on 127.0.0.1:${config.port}`);
    
    // Start replica handshake after server is listening
    if (config.role === ROLES.SLAVE) {
      const handshake = new ReplicaHandshake(config);
      // Start handshake in background
      setImmediate(() => handshake.start());
    }
  });
}

// Start the server
main().catch(console.error);