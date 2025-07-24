// /**
//  * Main entry point for the Redis server
//  */

// const { parseConfig } = require('./config/config-parser');
// const { createServer } = require('./server');
// const { ROLES } = require('./config/constants');
// const { initRDBLoader } = require('./storage/rdb-loader');
// const replicaHandshake = require('./replication/replica-handshake');

// // Parse command line arguments
// const config = parseConfig(process.argv);

// // Initialize the server based on role
// if (config.role === ROLES.MASTER) {
//   console.log('Starting server in MASTER mode');
  
//   // Initialize RDB loader if needed
//   initRDBLoader(config);
  
//   // Create and start the server
//   createServer(config);
// } else if (config.role === ROLES.REPLICA) {
//   console.log('Starting server in REPLICA mode');
//   console.log(`Connecting to master at ${config.masterHost}:${config.masterPort}`);
  
//   // Initialize RDB loader if needed
//   initRDBLoader(config);
  
//   // Create and start the server
//   const server = createServer(config);
  
//   // Connect to master and start replica handshake
//   replicaHandshake.connectToMaster(config, server);
// }

const net = require("net");
const fs = require("fs");
const path = require("path");
const db = {};
const streams = {}; // For XADD/XRANGE/XREAD
const masterReplId = "8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb";
const EMPTY_RDB = Buffer.from([
  0x52, 0x45, 0x44, 0x49, 0x53, 0x30, 0x30, 0x31, 0x31, 0xff, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00,
]);

let masterOffset = 0; // Total number of bytes of write commands propagated
let replicaSockets = []; // Store each replica connection with metadata
let pendingWAITs = []; // Pending WAIT commands (from clients)
let pendingXReads = []; // Pending XREAD BLOCK requests

// Get CLI args
let dir = "";
let dbfilename = "";
let port = 6379; // <-- default port
let role = "master";
let masterHost = null;
let masterPort = null;

const args = process.argv;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir" && i + 1 < args.length) {
    dir = args[i + 1];
  }
  if (args[i] === "--dbfilename" && i + 1 < args.length) {
    dbfilename = args[i + 1];
  }
  if (args[i] === "--port" && i + 1 < args.length) {
    // <-- support --port
    port = parseInt(args[i + 1], 10);
  }
  if (args[i] === "--replicaof" && i + 1 < args.length) {
    role = "slave";
    const [host, portStr] = args[i + 1].split(" ");
    masterHost = host;
    masterPort = parseInt(portStr, 10);
  }
}

// ==== REPLICA MODE: receive and apply commands from master ====
if (role === "slave" && masterHost && masterPort) {
  const masterConnection = net.createConnection(masterPort, masterHost, () => {
    masterConnection.write("*1\r\n$4\r\nPING\r\n");
  });

  let handshakeStep = 0;
  let awaitingRDB = false;
  let rdbBytesExpected = 0;
  let leftover = Buffer.alloc(0); // Buffer for command data

  masterConnection.on("data", (data) => {
    if (handshakeStep === 0) {
      const portStr = port.toString();
      masterConnection.write(
        `*3\r\n$8\r\nREPLCONF\r\n$14\r\nlistening-port\r\n$${portStr.length}\r\n${portStr}\r\n`
      );
      handshakeStep++;
      return;
    } else if (handshakeStep === 1) {
      masterConnection.write(
        "*3\r\n$8\r\nREPLCONF\r\n$4\r\ncapa\r\n$6\r\npsync2\r\n"
      );
      handshakeStep++;
      return;
    } else if (handshakeStep === 2) {
      masterConnection.write("*3\r\n$5\r\nPSYNC\r\n$1\r\n?\r\n$2\r\n-1\r\n");
      handshakeStep++;
      return;
    }

    // After handshake: receive RDB, then handle all incoming commands
    if (awaitingRDB) {
      // Still reading RDB file
      if (data.length >= rdbBytesExpected) {
        const afterRDB = data.slice(rdbBytesExpected);
        leftover = Buffer.concat([leftover, afterRDB]);
        awaitingRDB = false;
        processLeftover();
      } else {
        rdbBytesExpected -= data.length;
        // Still need more data for RDB
      }
      return;
    }

    if (!awaitingRDB) {
      const str = data.toString();
      if (str.startsWith("+FULLRESYNC")) {
        // Parse $<length>\r\n then RDB
        const idx = str.indexOf("\r\n$");
        if (idx !== -1) {
          const rest = str.slice(idx + 3);
          const match = rest.match(/^(\d+)\r\n/);
          if (match) {
            rdbBytesExpected = parseInt(match[1], 10);
            awaitingRDB = true;
            const rdbStart = idx + 3 + match[0].length;
            const rdbAvailable = data.slice(rdbStart);
            if (rdbAvailable.length >= rdbBytesExpected) {
              // We have whole RDB, handle what's after
              const afterRDB = rdbAvailable.slice(rdbBytesExpected);
              leftover = Buffer.concat([leftover, afterRDB]);
              awaitingRDB = false;
              processLeftover();
            } else {
              // Wait for the rest
              rdbBytesExpected -= rdbAvailable.length;
            }
            return;
          }
        }
      } else {
        // Already past RDB, this is propagated command data!
        leftover = Buffer.concat([leftover, data]);
        processLeftover();
      }
    }
  });

  masterConnection.on("error", (err) => {
    console.log("Error connecting to master:", err.message);
  });

  function processLeftover() {
    let offset = 0;
    while (offset < leftover.length) {
      const [arr, bytesRead] = tryParseRESP(leftover.slice(offset));
      if (!arr || bytesRead === 0) break;

      const command = arr[0] && arr[0].toLowerCase();

      // Handle REPLCONF GETACK *
      if (
        command === "replconf" &&
        arr[1] &&
        arr[1].toLowerCase() === "getack"
      ) {
        // RESP Array: *3\r\n$8\r\nREPLCONF\r\n$3\r\nACK\r\n$<len>\r\n<offset>\r\n
        const ackResp = `*3\r\n$8\r\nREPLCONF\r\n$3\r\nACK\r\n$${
          masterOffset.toString().length
        }\r\n${masterOffset}\r\n`;
        masterConnection.write(ackResp);
        masterOffset += bytesRead; // Only update offset after sending
      } else {
        masterOffset += bytesRead;
        handleReplicaCommand(arr); // Handles SET, etc, silently
      }

      offset += bytesRead;
    }
    leftover = leftover.slice(offset);
  }

  function handleReplicaCommand(cmdArr) {
    if (!cmdArr || !cmdArr[0]) return;
    const command = cmdArr[0].toLowerCase();

    if (command === "set") {
      const key = cmdArr[1];
      const value = cmdArr[2];

      let expiresAt = null;
      if (cmdArr.length >= 5 && cmdArr[3] && cmdArr[3].toLowerCase() === "px") {
        const px = parseInt(cmdArr[4], 10);
        expiresAt = Date.now() + px;
      }

      db[key] = { value, expiresAt, type: "string" };
    }
  }

  // Minimal RESP parser for a single array from Buffer, returns [arr, bytesRead]
  function tryParseRESP(buf) {
    if (buf[0] !== 42) return [null, 0]; // not '*'
    const str = buf.toString();
    const firstLineEnd = str.indexOf("\r\n");
    if (firstLineEnd === -1) return [null, 0];
    const numElems = parseInt(str.slice(1, firstLineEnd), 10);
    let elems = [];
    let cursor = firstLineEnd + 2;
    for (let i = 0; i < numElems; i++) {
      if (buf[cursor] !== 36) return [null, 0]; // not '$'
      const lenLineEnd = buf.indexOf("\r\n", cursor);
      if (lenLineEnd === -1) return [null, 0];
      const len = parseInt(buf.slice(cursor + 1, lenLineEnd).toString(), 10);
      const valStart = lenLineEnd + 2;
      const valEnd = valStart + len;
      if (valEnd + 2 > buf.length) return [null, 0]; // incomplete value
      const val = buf.slice(valStart, valEnd).toString();
      elems.push(val);
      cursor = valEnd + 2;
    }
    return [elems, cursor];
  }
}
// ==== END OF REPLICA MODE CHANGES ====

// === RDB FILE LOADING START ===
// Reads all key-value pairs (string type) from RDB, supports expiries
function loadRDB(filepath) {
  // Don't try to load if filepath is missing, doesn't exist, or is a directory!
  if (
    !filepath ||
    !fs.existsSync(filepath) ||
    !fs.statSync(filepath).isFile()
  ) {
    return;
  }
  const buffer = fs.readFileSync(filepath);
  let offset = 0;

  // Header: REDIS0011 (9 bytes)
  offset += 9;

  // Skip metadata sections (starts with 0xFA)
  while (buffer[offset] === 0xfa) {
    offset++; // skip FA
    // name
    let [name, nameLen] = readRDBString(buffer, offset);
    offset += nameLen;
    // value
    let [val, valLen] = readRDBString(buffer, offset);
    offset += valLen;
  }

  // Scan until 0xFE (start of database section)
  while (offset < buffer.length && buffer[offset] !== 0xfe) {
    offset++;
  }

  // DB section starts with 0xFE
  if (buffer[offset] === 0xfe) {
    offset++;
    // db index (size encoded)
    let [dbIndex, dbLen] = readRDBLength(buffer, offset);
    offset += dbLen;
    // Hash table size info: starts with FB
    if (buffer[offset] === 0xfb) {
      offset++;
      // key-value hash table size
      let [kvSize, kvSizeLen] = readRDBLength(buffer, offset);
      offset += kvSizeLen;
      // expiry hash table size (skip)
      let [expSize, expLen] = readRDBLength(buffer, offset);
      offset += expLen;

      // Only handle string type and expiry
      for (let i = 0; i < kvSize; ++i) {
        let expiresAt = null;

        // Handle optional expiry before type
        if (buffer[offset] === 0xfc) {
          // expiry in ms
          offset++;
          expiresAt = Number(buffer.readBigUInt64LE(offset));
          offset += 8;
        } else if (buffer[offset] === 0xfd) {
          // expiry in s
          offset++;
          expiresAt = buffer.readUInt32LE(offset) * 1000;
          offset += 4;
        }

        let type = buffer[offset++];
        if (type !== 0) continue; // 0 means string type

        let [key, keyLen] = readRDBString(buffer, offset);
        offset += keyLen;
        let [val, valLen] = readRDBString(buffer, offset);
        offset += valLen;
        db[key] = { value: val, expiresAt };
      }
    }
  }
}

// Helper: read size-encoded int
function readRDBLength(buffer, offset) {
  let first = buffer[offset];
  let type = first >> 6;
  if (type === 0) {
    return [first & 0x3f, 1];
  } else if (type === 1) {
    let val = ((first & 0x3f) << 8) | buffer[offset + 1];
    return [val, 2];
  } else if (type === 2) {
    let val =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];
    return [val, 5];
  } else if (type === 3) {
    return [0, 1];
  }
}

// Helper: read string-encoded value
function readRDBString(buffer, offset) {
  let [strlen, lenlen] = readRDBLength(buffer, offset);
  offset += lenlen;
  let str = buffer.slice(offset, offset + strlen).toString();
  return [str, lenlen + strlen];
}

// Try to load the RDB file only if dir and dbfilename are set!
let rdbPath = "";
if (dir && dbfilename) {
  rdbPath = path.join(dir, dbfilename);
  loadRDB(rdbPath);
  // console.log("Loaded keys from RDB:", Object.keys(db)); // Uncomment for debug
}
// === RDB FILE LOADING END ===

// You can use print statements as follows for debugging, they'll be visible when running tests.
console.log("Logs from your program will appear here!");

// Helper: is a command a write command?
function isWriteCommand(cmd) {
  // Add more if needed (DEL, etc.)
  return ["set", "del", "xadd"].includes(cmd);
}

// Helper: encode RESP array from array of strings
function encodeRespArray(arr) {
  let resp = `*${arr.length}\r\n`;
  for (const val of arr) {
    resp += `$${val.length}\r\n${val}\r\n`;
  }
  return resp;
}

// Deep encoder for nested RESP arrays
function encodeRespArrayDeep(arr) {
  let resp = `*${arr.length}\r\n`;
  for (const item of arr) {
    if (Array.isArray(item)) {
      resp += encodeRespArrayDeep(item);
    } else {
      resp += `$${item.length}\r\n${item}\r\n`;
    }
  }
  return resp;
}

function encodeRespInteger(n) {
  return `:${n}\r\n`;
}

// Helper: generate stream entry ID
function generateStreamId(userIdPart, streams, streamKey) {
  if (userIdPart === "*") {
    // Auto-generate full ID
    return `${Date.now()}-0`;
  }
  
  if (userIdPart.endsWith("-*")) {
    // User provided ms part, auto-generate sequence
    const msPart = userIdPart.slice(0, -2);
    const ms = parseInt(msPart, 10);
    
    // Find the highest sequence number for this ms timestamp
    let maxSeq = -1; // Start from -1, so if no entries exist, first will be 0
    if (streams[streamKey]) {
      for (const entry of streams[streamKey]) {
        const [entryMs, entrySeq] = entry.id.split("-").map(Number);
        if (entryMs === ms) {
          maxSeq = Math.max(maxSeq, entrySeq);
        }
      }
    }
    
    // Special case: if timestamp is 0 and no entries exist, start from sequence 1
    // because 0-0 is an invalid/reserved ID in Redis
    if (ms === 0 && maxSeq === -1) {
      return `${ms}-1`;
    }
    
    return `${ms}-${maxSeq + 1}`;
  }
  
  // User provided full ID, use as-is
  return userIdPart;
}

// Helper: validate stream entry ID
function isValidStreamId(id, streams, streamKey) {
  // Note: 0-0 case is handled separately in XADD command
  const [ms, seq] = id.split("-").map(Number);
  if (ms < 0 || seq < 0) return false;
  
  // Check if ID is greater than all existing IDs
  if (streams[streamKey]) {
    for (const entry of streams[streamKey]) {
      const [existingMs, existingSeq] = entry.id.split("-").map(Number);
      if (ms < existingMs || (ms === existingMs && seq <= existingSeq)) {
        return false;
      }
    }
  }
  
  return true;
}

// ==== MAIN SERVER STARTS HERE ====
server = net.createServer((connection) => {
  // ==== CHANGES FOR REPLICATION START ====
  connection.isReplica = false; // Mark whether this socket is a replica
  connection.lastAckOffset = 0; // Used for replicas, tracks last ACK offset
  // ==== CHANGES FOR REPLICATION END ====

  // Handle connection
  connection.on("data", (data) => {
    // LOG what the master receives
    console.log("Master received:", data.toString());

    const cmdArr = parseRESP(data);

    if (!cmdArr || !cmdArr[0]) return;

    const command = cmdArr[0].toLowerCase();

    // ==== CHANGES FOR REPLICATION START ====
    // Detect if this is the replication connection

    // REPLCONF GETACK handler: fix for Codecrafters test
    if (
      command === "replconf" &&
      cmdArr[1] &&
      cmdArr[1].toLowerCase() === "getack"
    ) {
      // Respond with *3\r\n$8\r\nREPLCONF\r\n$3\r\nACK\r\n$<len>\r\n<offset>\r\n
      const offsetStr = masterOffset.toString();
      const resp = `*3\r\n$8\r\nREPLCONF\r\n$3\r\nACK\r\n$${offsetStr.length}\r\n${offsetStr}\r\n`;
      connection.write(resp);
      return;
    }

    if (command === "psync") {
      connection.isReplica = true;
      connection.lastAckOffset = 0;
      replicaSockets.push(connection);

      // 1. Send FULLRESYNC
      connection.write(`+FULLRESYNC ${masterReplId} 0\r\n`);
      // 2. Send empty RDB file as bulk string (version 11)
      connection.write(`$${EMPTY_RDB.length}\r\n`);
      connection.write(EMPTY_RDB);
      // No extra \r\n after this!
      return;
    }

    // ===== HANDLE REPLCONF ACK FROM REPLICA =====
    if (
      connection.isReplica &&
      command === "replconf" &&
      cmdArr[1] &&
      cmdArr[1].toLowerCase() === "ack" &&
      cmdArr[2]
    ) {
      const ackOffset = parseInt(cmdArr[2], 10) || 0;
      connection.lastAckOffset = ackOffset;
      resolveWAITs();
      return;
    }

    // ===== ALWAYS REPLY TO OTHER REPLCONF COMMANDS WITH +OK =====
    if (command === "replconf") {
      connection.write("+OK\r\n");
      return;
    }
    // ==== CHANGES FOR REPLICATION END ====

    // PING command
    if (command === "ping") {
      connection.write("+PONG\r\n");
      return;
    }

    // ECHO command
    if (command === "echo") {
      const message = cmdArr[1] || "";
      connection.write(`$${message.length}\r\n${message}\r\n`);
      return;
    }

    // SET command
    if (command === "set") {
      const key = cmdArr[1];
      const value = cmdArr[2];

      let expiresAt = null;
      if (cmdArr.length >= 5 && cmdArr[3] && cmdArr[3].toLowerCase() === "px") {
        const px = parseInt(cmdArr[4], 10);
        expiresAt = Date.now() + px;
      }

      db[key] = { value, expiresAt, type: "string" };
      connection.write("+OK\r\n");

      // Propagate to replicas if this is a master and not from a replica
      if (!connection.isReplica && replicaSockets.length > 0) {
        const respCmd = encodeRespArray(cmdArr);
        masterOffset += Buffer.byteLength(respCmd, "utf8");
        replicaSockets.forEach((sock) => {
          if (sock.writable) {
            sock.write(respCmd);
          }
        });
      }
      return;
    }

    // GET command
    if (command === "get") {
      const key = cmdArr[1];
      const entry = db[key];

      if (!entry) {
        connection.write("$-1\r\n"); // null
        return;
      }

      // Check expiry
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        delete db[key];
        connection.write("$-1\r\n"); // null
        return;
      }

      const value = entry.value;
      connection.write(`$${value.length}\r\n${value}\r\n`);
      return;
    }

    // INCR command
    if (command === "incr") {
      const key = cmdArr[1];
      let entry = db[key];

      // Check if key exists and hasn't expired
      if (entry && entry.expiresAt && Date.now() > entry.expiresAt) {
        delete db[key];
        entry = null;
      }

      let currentValue = 0;
      if (entry) {
        const parsed = parseInt(entry.value, 10);
        if (isNaN(parsed)) {
          connection.write("-ERR value is not an integer or out of range\r\n");
          return;
        }
        currentValue = parsed;
      }

      const newValue = currentValue + 1;
      db[key] = { value: newValue.toString(), expiresAt: null, type: "string" };
      connection.write(`:${newValue}\r\n`);
      return;
    }

    // XADD command
   if (command === "xadd") {
  const streamKey = cmdArr[1];
  const userIdPart = cmdArr[2];

  // Generate or validate the entry ID
  let entryId;
  if (userIdPart === "*" || userIdPart.includes("-*")) {
    entryId = generateStreamId(userIdPart, streams, streamKey);
  } else {
    entryId = userIdPart;

    // Special case: check for 0-0 which is always invalid
    if (entryId === "0-0") {
      connection.write("-ERR The ID specified in XADD must be greater than 0-0\r\n");
      return;
    }

    if (!isValidStreamId(entryId, streams, streamKey)) {
      connection.write("-ERR The ID specified in XADD is equal or smaller than the target stream top item\r\n");
      return;
    }
  }

  // Initialize stream if it doesn't exist
  if (!streams[streamKey]) {
    streams[streamKey] = {
      type: "stream",
      entries: []
    };
  }

  // Create the entry with field-value pairs
  const entry = { id: entryId };
  for (let i = 3; i < cmdArr.length; i += 2) {
    if (i + 1 < cmdArr.length) {
      entry[cmdArr[i]] = cmdArr[i + 1];
    }
  }

  // Add to stream entries
  streams[streamKey].entries.push(entry);

  // Send the generated ID back to the client
  connection.write(`$${entryId.length}\r\n${entryId}\r\n`);

  // Check for blocked XREAD clients
  maybeFulfillBlockedXREADs(streamKey, entry);

  // Propagate to replicas if this is a master and not from a replica
  if (!connection.isReplica && replicaSockets.length > 0) {
    const respCmd = encodeRespArray(cmdArr);
    masterOffset += Buffer.byteLength(respCmd, "utf8");
    replicaSockets.forEach((sock) => {
      if (sock.writable) {
        sock.write(respCmd);
      }
    });
  }

  return;
}


    // XRANGE command
if (command === "xadd") {
  const streamKey = cmdArr[1];
  const userIdPart = cmdArr[2];

  // Generate or validate the entry ID
  let entryId;
  if (userIdPart === "*" || userIdPart.includes("-*")) {
    entryId = generateStreamId(userIdPart, streams, streamKey);
  } else {
    entryId = userIdPart;

    // Special case: check for 0-0 which is always invalid
    if (entryId === "0-0") {
      connection.write("-ERR The ID specified in XADD must be greater than 0-0\r\n");
      return;
    }

    if (!isValidStreamId(entryId, streams, streamKey)) {
      connection.write("-ERR The ID specified in XADD is equal or smaller than the target stream top item\r\n");
      return;
    }
  }

  // Initialize stream if it doesn't exist
  if (!streams[streamKey]) {
    streams[streamKey] = {
      type: "stream",
      entries: []
    };
  }

  // Create the entry with field-value pairs
  const entry = { id: entryId };
  for (let i = 3; i < cmdArr.length; i += 2) {
    if (i + 1 < cmdArr.length) {
      entry[cmdArr[i]] = cmdArr[i + 1];
    }
  }

  // Add to stream entries
  streams[streamKey].entries.push(entry);

  // Send the generated ID back to the client
  connection.write(`$${entryId.length}\r\n${entryId}\r\n`);

  // Check for blocked XREAD clients
  maybeFulfillBlockedXREADs(streamKey, entry);

  // Propagate to replicas if this is a master and not from a replica
  if (!connection.isReplica && replicaSockets.length > 0) {
    const respCmd = encodeRespArray(cmdArr);
    masterOffset += Buffer.byteLength(respCmd, "utf8");
    replicaSockets.forEach((sock) => {
      if (sock.writable) {
        sock.write(respCmd);
      }
    });
  }

  return;
}


    // XREAD command
    if (command === "xread") {
      let blockTimeout = null;
      let argIndex = 1;

      // Check for BLOCK option
      if (cmdArr[argIndex] && cmdArr[argIndex].toLowerCase() === "block") {
        blockTimeout = parseInt(cmdArr[argIndex + 1], 10);
        argIndex += 2;
      }

      // Next should be "streams"
      if (!cmdArr[argIndex] || cmdArr[argIndex].toLowerCase() !== "streams") {
        connection.write("-ERR syntax error\r\n");
        return;
      }
      argIndex++;

      // Parse streams and IDs
      const remainingArgs = cmdArr.slice(argIndex);
      const numStreams = Math.floor(remainingArgs.length / 2);
      const streamKeys = remainingArgs.slice(0, numStreams);
      const streamIds = remainingArgs.slice(numStreams);

      if (streamKeys.length !== streamIds.length) {
        connection.write("-ERR syntax error\r\n");
        return;
      }

      // Process each stream
      const results = [];
      let hasData = false;

      for (let i = 0; i < streamKeys.length; i++) {
        const streamKey = streamKeys[i];
        let afterId = streamIds[i];

        // Handle special case: $ means "current latest ID"
        if (afterId === "$") {
          if (streams[streamKey] && streams[streamKey].length > 0) {
            afterId = streams[streamKey][streams[streamKey].length - 1].id;
          } else {
            afterId = "0-0"; // If stream doesn't exist, start from beginning
          }
        }

        if (!streams[streamKey]) {
          continue;
        }

        const streamEntries = [];
        const [afterMs, afterSeq] = afterId.split("-").map(Number);

        for (const entry of streams[streamKey]) {
          const [entryMs, entrySeq] = entry.id.split("-").map(Number);
          
          // Only include entries that come after the specified ID
          if (entryMs > afterMs || (entryMs === afterMs && entrySeq > afterSeq)) {
            const fields = [];
            for (const [key, value] of Object.entries(entry)) {
              if (key !== "id") {
                fields.push(key, value);
              }
            }
            streamEntries.push([entry.id, fields]);
          }
        }

        if (streamEntries.length > 0) {
          results.push([streamKey, streamEntries]);
          hasData = true;
        }
      }

      // If we have data or not blocking, return immediately
      if (hasData || blockTimeout === null) {
        if (results.length === 0) {
          connection.write("$-1\r\n"); // null
        } else {
          connection.write(encodeRespArrayDeep(results));
        }
        return;
      }

      // Block and wait for new data
      if (blockTimeout === 0) {
        // Block indefinitely
        pendingXReads.push({
          conn: connection,
          streams: streamKeys,
          ids: streamIds,
          timer: null
        });
      } else {
        // Block with timeout
        const timer = setTimeout(() => {
          connection.write("$-1\r\n"); // timeout, return null
          pendingXReads = pendingXReads.filter(p => p.conn !== connection);
        }, blockTimeout);

        pendingXReads.push({
          conn: connection,
          streams: streamKeys,
          ids: streamIds,
          timer: timer
        });
      }
      return;
    }

    // TYPE command
    if (command === "type") {
      const key = cmdArr[1];
      const entry = db[key];

      if (!entry) {
        connection.write("+none\r\n");
        return;
      }

      // Check expiry
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        delete db[key];
        connection.write("+none\r\n");
        return;
      }

      const type = entry.type || "string";
      connection.write(`+${type}\r\n`);
      return;
    }

    // CONFIG GET command
    if (command === "config" && cmdArr[1] && cmdArr[1].toLowerCase() === "get") {
      const param = cmdArr[2];
      if (param === "dir") {
        connection.write(`*2\r\n$3\r\ndir\r\n$${dir.length}\r\n${dir}\r\n`);
      } else if (param === "dbfilename") {
        connection.write(`*2\r\n$10\r\ndbfilename\r\n$${dbfilename.length}\r\n${dbfilename}\r\n`);
      } else {
        connection.write("*0\r\n"); // empty array for unknown config
      }
      return;
    }

    // KEYS command
    if (command === "keys") {
      const pattern = cmdArr[1];
      const keys = Object.keys(db).filter(key => {
        const entry = db[key];
        // Skip expired keys
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
          delete db[key];
          return false;
        }
        
        if (pattern === "*") {
          return true;
        }
        // Simple pattern matching - you can extend this for more complex patterns
        return key.includes(pattern.replace("*", ""));
      });

      connection.write(`*${keys.length}\r\n`);
      keys.forEach(key => {
        connection.write(`${key.length}\r\n${key}\r\n`);
      });
      return;
    }

    // INFO command
    if (command === "info") {
      const section = cmdArr[1];
      let info = "";

      if (!section || section.toLowerCase() === "replication") {
        info += `role:${role}\r\n`;
        info += `master_replid:${masterReplId}\r\n`;
        info += `master_repl_offset:${masterOffset}\r\n`;
      }

      connection.write(`${info.length}\r\n${info}\r\n`);
      return;
    }

    // WAIT command
    if (command === "wait") {
      const numReplicas = parseInt(cmdArr[1], 10) || 0;
      const timeout = parseInt(cmdArr[2], 10) || 0;
      handleWAITCommand(connection, numReplicas, timeout);
      return;
    }

    // Unknown command
    connection.write("-ERR unknown command\r\n");
  });

  connection.on("error", (err) => {
    console.log("Socket error:", err.message);
  });
  
  connection.on("close", () => {
    if (connection.isReplica) {
      replicaSockets = replicaSockets.filter((sock) => sock !== connection);
      resolveWAITs();
    }
    // Clean up pending XREADs for closed connections
    pendingXReads = pendingXReads.filter((p) => p.conn !== connection);
  });
});

server.listen(port, "127.0.0.1"); // <-- use correct port!

// RESP parser function (used by master/client handlers, not replica stream)
function parseRESP(buffer) {
  const str = buffer.toString();

  if (str[0] !== "*") {
    return null;
  }

  const parts = str.split("\r\n").filter(Boolean);

  let arr = [];
  for (let i = 2; i < parts.length; i += 2) {
    arr.push(parts[i]);
  }

  return arr;
}

// ====== WAIT logic below ======
function handleWAITCommand(clientConn, numReplicas, timeout) {
  const waitOffset = masterOffset;
  let resolved = false;

  // Send REPLCONF GETACK * to all replicas
  replicaSockets.forEach((sock) => {
    if (sock.writable) {
      sock.write("*3\r\n$8\r\nREPLCONF\r\n$6\r\nGETACK\r\n$1\r\n*\r\n");
    }
  });

  function countAcks() {
    return replicaSockets.filter((r) => r.lastAckOffset >= waitOffset).length;
  }

  function maybeResolve() {
    if (resolved) return;
    let acked = countAcks();
    if (acked >= numReplicas) {
      resolved = true;
      clientConn.write(encodeRespInteger(acked));
      clearTimeout(timer);
      pendingWAITs = pendingWAITs.filter((w) => w !== waitObj);
    }
  }

  // Immediate resolve if enough already
  if (countAcks() >= numReplicas) {
    clientConn.write(encodeRespInteger(countAcks()));
    return;
  }

  // Else, push pending WAIT
  let timer = setTimeout(() => {
    if (!resolved) {
      let acked = countAcks();
      clientConn.write(encodeRespInteger(acked));
      resolved = true;
      pendingWAITs = pendingWAITs.filter((w) => w !== waitObj);
    }
  }, timeout);

  const waitObj = { waitOffset, numReplicas, clientConn, timer, maybeResolve };
  pendingWAITs.push(waitObj);
}

// Call this function after "any" replica ACK is received
function resolveWAITs() {
  pendingWAITs.forEach((w) => w.maybeResolve());
}

function maybeFulfillBlockedXREADs(streamKey, newEntry) {
  for (let i = 0; i < pendingXReads.length; ++i) {
    let p = pendingXReads[i];
    let idx = p.streams.indexOf(streamKey);
    if (idx === -1) continue;
    let [lastMs, lastSeq] = p.ids[idx].split("-").map(Number);
    let [eMs, eSeq] = newEntry.id.split("-").map(Number);
    if (eMs > lastMs || (eMs === lastMs && eSeq > lastSeq)) {
      // Compose reply just like normal XREAD for this stream only
      let fields = [];
      for (let [k, v] of Object.entries(newEntry))
        if (k !== "id") fields.push(k, v);
      let reply = [[streamKey, [[newEntry.id, fields]]]];
      p.conn.write(encodeRespArrayDeep(reply));
      clearTimeout(p.timer);
      pendingXReads[i] = null;
    }
  }
  pendingXReads = pendingXReads.filter(Boolean);
}