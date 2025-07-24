/**
 * Command dispatching and handling
 */

const {
  encodeSimpleString,
  encodeBulkString,
  encodeInteger,
  encodeArray,
  encodeArrayDeep
} = require('../protocol/resp');

const store = require('../storage/store');
const replicaManager = require('../replication/replica-manager');

// Pending XREAD BLOCK requests
let pendingXReads = [];

/**
 * Handle the PING command
 * @param {net.Socket} connection - Client connection
 * @returns {string} RESP response
 */
function handlePing(connection) {
  return encodeSimpleString('PONG');
}

/**
 * Handle the ECHO command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleEcho(connection, cmdArr) {
  const message = cmdArr[1] || '';
  return encodeBulkString(message);
}

/**
 * Handle the SET command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleSet(connection, cmdArr) {
  const key = cmdArr[1];
  const value = cmdArr[2];

  // Default: no expiry
  let expiresAt = null;

  // Check for PX (case-insensitive)
  if (cmdArr.length >= 5 && cmdArr[3].toLowerCase() === 'px') {
    const px = parseInt(cmdArr[4], 10);
    expiresAt = Date.now() + px;
  }

  store.set(key, value, expiresAt, 'string');
  
  // Propagate to replicas
  replicaManager.propagateCommand(cmdArr, connection);
  
  return encodeSimpleString('OK');
}

/**
 * Handle the GET command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleGet(connection, cmdArr) {
  const key = cmdArr[1];
  const record = store.get(key);

  if (record) {
    return encodeBulkString(record.value);
  } else {
    return encodeBulkString(null); // Null bulk string
  }
}

/**
 * Handle the INCR command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleIncr(connection, cmdArr) {
  const key = cmdArr[1];
  const newValue = store.incr(key);
  
  if (newValue !== null) {
    return encodeInteger(newValue);
  }
  
  // Handle error case
  return encodeSimpleString('ERR value is not an integer or out of range');
}
/**
 * Handle the XADD command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleXadd(connection, cmdArr) {
  const streamKey = cmdArr[1];
  let id = cmdArr[2];
  
  // Parse XADD id (handle '*', '<ms>-*', or explicit)
  let ms, seq;
  
  // Fully auto
  if (id === '*') {
    ms = Date.now();
    seq = 0;
    const streamData = store.get(streamKey);
    if (streamData && streamData.type === 'stream' && streamData.entries.length > 0) {
      const last = streamData.entries[streamData.entries.length - 1];
      const [lastMs, lastSeq] = last.id.split('-').map(Number);
      if (lastMs === ms) {
        seq = lastSeq + 1;
      }
    }
    id = `${ms}-${seq}`;
  }
  // Partially auto
  else if (/^\d+-\*$/.test(id)) {
    ms = Number(id.split('-')[0]);
    const streamData = store.get(streamKey);
    if (!streamData || streamData.entries.length === 0) {
      seq = ms === 0 ? 1 : 0;
    } else {
      let maxSeq = -1;
      for (let i = streamData.entries.length - 1; i >= 0; i--) {
        const [entryMs, entrySeq] = streamData.entries[i].id
          .split('-')
          .map(Number);
        if (entryMs === ms) {
          maxSeq = Math.max(maxSeq, entrySeq);
        }
        if (entryMs < ms) break; // stop searching
      }
      seq = maxSeq >= 0 ? maxSeq + 1 : ms === 0 ? 1 : 0;
    }
    id = `${ms}-${seq}`;
  } else {
    // Explicit
    const parts = id.split('-');
    ms = Number(parts[0]);
    seq = Number(parts[1]);
  }
  
  // Validate id
  if (!/^\d+-\d+$/.test(id) || ms < 0 || seq < 0) {
    return encodeSimpleString('ERR The ID specified in XADD must be greater than 0-0');
  }
  if (ms === 0 && seq === 0) {
    return encodeSimpleString('ERR The ID specified in XADD must be greater than 0-0');
  }
  if (ms === 0 && seq < 1) {
    return encodeSimpleString('ERR The ID specified in XADD must be greater than 0-0');
  }
  
  // Prepare field-value pairs
  const pairs = {};
  for (let i = 3; i + 1 < cmdArr.length; i += 2) {
    pairs[cmdArr[i]] = cmdArr[i + 1];
  }
  
  // Stream creation if needed
  if (!store.get(streamKey)) {
    store.set(streamKey, { entries: [] }, null, 'stream');
  }
  
  // Get the stream
  const streamData = store.get(streamKey);
 
  // Strictly greater than last entry check!
  const entries = streamData.entries;
  if (entries.length > 0) {
    const last = entries[entries.length - 1];
    const [lastMs, lastSeq] = last.id.split('-').map(Number);
    if (ms < lastMs || (ms === lastMs && seq <= lastSeq)) {
      return encodeSimpleString('ERR The ID specified in XADD is equal or smaller than the target stream top item');
    }
  }
  
  // Add entry
  const entry = { id, ...pairs };
  streamData.entries.push(entry);
 
  // Handle XREAD BLOCK
  fulfillPendingXReads(streamKey, entry);
 
  return encodeBulkString(id);
}

/**
 * Handle the XRANGE command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleXrange(connection, cmdArr) {
  const streamKey = cmdArr[1];
  let start = cmdArr[2];
  let end = cmdArr[3];

  // Check if stream exists and is a stream type
  const streamData = store.get(streamKey);
  if (!streamData || streamData.type !== 'stream') {
    // Return empty array if stream does not exist or is not a stream
    return encodeArray([]);
  }

  // Parse start and end IDs
  function parseId(idStr, isEnd) {
    if (idStr === '-') {
      // Minimal possible value for start of stream
      return [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
    }
    if (idStr === '+') {
      // Max possible value for end of stream
      return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    }
    if (idStr.includes('-')) {
      const [ms, seq] = idStr.split('-');
      return [parseInt(ms, 10), parseInt(seq, 10)];
    } else {
      // If only milliseconds, default to 0 for start or MAX_SAFE_INTEGER for end
      if (isEnd) {
        return [parseInt(idStr, 10), Number.MAX_SAFE_INTEGER];
      } else {
        return [parseInt(idStr, 10), 0];
      }
    }
  }

  const [startMs, startSeq] = parseId(start, false);
  const [endMs, endSeq] = parseId(end, true);

  // Filter entries in the inclusive range
  const result = [];
  for (const entry of streamData.entries) {
    const [eMs, eSeq] = entry.id.split('-').map(Number);
    // Compare IDs (start <= entry.id <= end)
    const afterStart =
      eMs > startMs || (eMs === startMs && eSeq >= startSeq);
    const beforeEnd = eMs < endMs || (eMs === endMs && eSeq <= endSeq);
    if (afterStart && beforeEnd) {
      // Convert entry (id, ...fields) to expected RESP array format
      const pairs = [];
      for (const [k, v] of Object.entries(entry)) {
        if (k === 'id') continue;
        pairs.push(k, v);
      }
      result.push([entry.id, pairs]);
    }
  }

  return encodeArrayDeep(result);
}

/**
 * Handle the XREAD command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleXread(connection, cmdArr) {
  // Parse XREAD arguments
  let blockMs = null;
  let blockIdx = cmdArr.findIndex((x) => x.toLowerCase() === 'block');
  let streamsIdx = cmdArr.findIndex((x) => x.toLowerCase() === 'streams');
  
  if (blockIdx !== -1) {
    blockMs = parseInt(cmdArr[blockIdx + 1], 10);
  }
  
  if (streamsIdx === -1) {
    return encodeArray([]);
  }
  
  // Get stream keys and IDs
  const streams = [];
  const ids = [];
  let s = streamsIdx + 1;
  
  while (s < cmdArr.length && !cmdArr[s].includes('-') && cmdArr[s] !== '$') {
    streams.push(cmdArr[s]);
    s++;
  }
  
  while (s < cmdArr.length) {
    ids.push(cmdArr[s]);
    s++;
  }
  
  // Fix for $: resolve $ to last id of each stream at time of blocking
  const resolvedIds = [];
  for (let i = 0; i < streams.length; ++i) {
    const key = streams[i];
    const reqId = ids[i];
    if (reqId === '$') {
      const streamData = store.get(key);
      if (streamData && streamData.type === 'stream' && streamData.entries.length > 0) {
        // Last entry's id at the moment of blocking
        const lastEntry = streamData.entries[streamData.entries.length - 1];
        resolvedIds.push(lastEntry.id);
      } else {
        resolvedIds.push('0-0');
      }
    } else {
      resolvedIds.push(reqId);
    }
  }
  
  // Find new entries for each stream
  let found = [];
  for (let i = 0; i < streams.length; ++i) {
    const k = streams[i];
    const id = resolvedIds[i];
    const arr = [];
    const streamData = store.get(k);
    
    if (streamData && streamData.type === 'stream') {
      let [lastMs, lastSeq] = id.split('-').map(Number);
      for (const entry of streamData.entries) {
        let [eMs, eSeq] = entry.id.split('-').map(Number);
        if (eMs > lastMs || (eMs === lastMs && eSeq > lastSeq)) {
          let fields = [];
          for (let [kk, vv] of Object.entries(entry))
            if (kk !== 'id') fields.push(kk, vv);
          arr.push([entry.id, fields]);
        }
      }
    }
    
    if (arr.length) found.push([k, arr]);
  }
  
  if (found.length) {
    return encodeArrayDeep(found);
  }
  
  if (blockMs === null) {
    // no block param, normal XREAD
    return encodeArray([]);
  }
  
  // If blockMs is 0, do not set timeout (block forever)
  let timeout = null;
  if (blockMs > 0) {
    timeout = setTimeout(() => {
      connection.write(encodeBulkString(null));
      pendingXReads = pendingXReads.filter(
        (obj) => obj.conn !== connection
      );
    }, blockMs);
  }
  
  // Save resolvedIds (NOT the original ids!) for this blocked read
  pendingXReads.push({
    conn: connection,
    streams,
    ids: resolvedIds,
    timer: timeout,
  });
  
  return null; // No immediate response, will respond later
}

/**
 * Handle the TYPE command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleType(connection, cmdArr) {
  const key = cmdArr[1];
  return encodeSimpleString(store.type(key));
}

/**
 * Handle the CONFIG GET command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @param {Object} config - Server configuration
 * @returns {string} RESP response
 */
function handleConfigGet(connection, cmdArr, config) {
  const param = cmdArr[2].toLowerCase();
  let value = '';
  
  if (param === 'dir') {
    value = config.dir;
  } else if (param === 'dbfilename') {
    value = config.dbfilename;
  }
  
  // RESP array of 2 bulk strings: [param, value]
  return encodeArray([param, value]);
}

/**
 * Handle the KEYS command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleKeys(connection, cmdArr) {
  const pattern = cmdArr[1];
  const keys = store.keys(pattern);
  return encodeArray(keys);
}

/**
 * Handle the INFO command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @param {Object} config - Server configuration
 * @returns {string} RESP response
 */
function handleInfo(connection, cmdArr, config) {
  if (cmdArr[1] && cmdArr[1].toLowerCase() === 'replication') {
    const infoStr = replicaManager.getReplicationInfo(config.role);
    return encodeBulkString(infoStr);
  }
  
  return encodeBulkString('');
}

/**
 * Handle the REPLCONF command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string} RESP response
 */
function handleReplconf(connection, cmdArr) {
  // Handle REPLCONF ACK from replica
  if (connection.isReplica && cmdArr[1] && cmdArr[1].toLowerCase() === 'ack' && cmdArr[2]) {
    replicaManager.handleReplicaAck(connection, cmdArr[2]);
  }
  
  // Handle REPLCONF GETACK
  if (cmdArr[1] && cmdArr[1].toLowerCase() === 'getack') {
    const offsetStr = replicaManager.masterOffset.toString();
    return encodeArray(['REPLCONF', 'ACK', offsetStr]);
  }
  
  // Default response for other REPLCONF commands
  return encodeSimpleString('OK');
}

/**
 * Handle the PSYNC command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string|null} RESP response or null if handled directly
 */
function handlePsync(connection, cmdArr) {
  replicaManager.handleNewReplica(connection);
  return null; // Response is handled directly in handleNewReplica
}

/**
 * Handle the WAIT command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @returns {string|null} RESP response or null if handled asynchronously
 */
function handleWait(connection, cmdArr) {
  const numReplicas = parseInt(cmdArr[1], 10) || 0;
  const timeout = parseInt(cmdArr[2], 10) || 0;
  replicaManager.handleWAITCommand(connection, numReplicas, timeout);
  return null; // Response is handled asynchronously
}

/**
 * Fulfill pending XREAD BLOCK requests when new data is available
 * @param {string} streamKey - The stream key that was updated
 * @param {Object} newEntry - The new entry that was added
 */
function fulfillPendingXReads(streamKey, newEntry) {
  let remaining = [];
  
  for (let req of pendingXReads) {
    let found = [];
    for (let i = 0; i < req.streams.length; ++i) {
      const k = req.streams[i];
      let id = req.ids[i];
      
      if (k === streamKey) {
        let [lastMs, lastSeq] = id.split('-').map(Number);
        let [eMs, eSeq] = newEntry.id.split('-').map(Number);
        
        if (eMs > lastMs || (eMs === lastMs && eSeq > lastSeq)) {
          let fields = [];
          for (let [kk, vv] of Object.entries(newEntry))
            if (kk !== 'id') fields.push(kk, vv);
          
          found.push([k, [[newEntry.id, fields]]]);
          break;
        }
      }
    }
    
    if (found.length) {
      if (req.timer) clearTimeout(req.timer);
      req.conn.write(encodeArrayDeep(found));
    } else {
      remaining.push(req); // keep waiting
    }
  }
  
  pendingXReads = remaining;
}

/**
 * Handle a Redis command
 * @param {net.Socket} connection - Client connection
 * @param {string[]} cmdArr - Command array
 * @param {Object} config - Server configuration
 * @returns {string|null} RESP response or null if handled directly
 */
function handleCommand(connection, cmdArr, config) {
  if (!cmdArr || !cmdArr[0]) return null;

  const command = cmdArr[0].toLowerCase();

  switch (command) {
    case 'ping':
      return handlePing(connection);
    case 'echo':
      return handleEcho(connection, cmdArr);
    case 'set':
      return handleSet(connection, cmdArr);
    case 'get':
      return handleGet(connection, cmdArr);
    case 'incr':
      return handleIncr(connection, cmdArr);
    case 'xadd':
      return handleXadd(connection, cmdArr);
    case 'xrange':
      return handleXrange(connection, cmdArr);
    case 'xread':
      return handleXread(connection, cmdArr);
    case 'type':
      return handleType(connection, cmdArr);
    case 'config':
      if (cmdArr[1] && cmdArr[1].toLowerCase() === 'get' && cmdArr[2]) {
        return handleConfigGet(connection, cmdArr, config);
      }
      break;
    case 'keys':
      return handleKeys(connection, cmdArr);
    case 'info':
      return handleInfo(connection, cmdArr, config);
    case 'replconf':
      return handleReplconf(connection, cmdArr);
    case 'psync':
      return handlePsync(connection, cmdArr);
    case 'wait':
      return handleWait(connection, cmdArr);
    default:
      return encodeSimpleString('ERR unknown command');
  }

  return null;
}

module.exports = {
  handleCommand,
  pendingXReads
};