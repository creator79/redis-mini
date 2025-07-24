/**
 * Replica management and WAIT command implementation
 */

const { encodeInteger, encodeArray } = require('../protocol/resp');
const { EMPTY_RDB, MASTER_REPL_ID } = require('../config/constants');

// Replication state
let masterOffset = 0; // Total number of bytes of write commands propagated
let replicaSockets = []; // Store each replica connection with metadata
let pendingWAITs = []; // Pending WAIT commands (from clients)

/**
 * Handle a new replica connection
 * @param {net.Socket} connection - The socket connection from the replica
 */
function handleNewReplica(connection) {
  connection.isReplica = true;
  connection.lastAckOffset = 0;
  replicaSockets.push(connection);

  // 1. Send FULLRESYNC
  connection.write(`+FULLRESYNC ${MASTER_REPL_ID} 0\r\n`);
  // 2. Send empty RDB file as bulk string (version 11)
  connection.write(`$${EMPTY_RDB.length}\r\n`);
  connection.write(EMPTY_RDB);
  // No extra \r\n after this!
}

/**
 * Handle REPLCONF ACK from replica
 * @param {net.Socket} connection - The socket connection from the replica
 * @param {string} offsetStr - The offset string from the ACK command
 */
function handleReplicaAck(connection, offsetStr) {
  const ackOffset = parseInt(offsetStr, 10) || 0;
  connection.lastAckOffset = ackOffset;
  resolveWAITs();
}

/**
 * Propagate a command to all replicas
 * @param {string[]} cmdArr - The command array to propagate
 * @param {net.Socket} sourceConnection - The connection that issued the command
 */
function propagateCommand(cmdArr, sourceConnection) {
  // Only propagate if this is NOT from a replica and we have replicas
  if (!sourceConnection.isReplica && replicaSockets.length > 0) {
    const respCmd = encodeArray(cmdArr); // Already has correct casing/args
    masterOffset += Buffer.byteLength(respCmd, 'utf8'); // Track the master replication offset
    
    // Send to all still-writable replicas
    replicaSockets.forEach((sock) => {
      if (sock.writable) {
        sock.write(respCmd);
      }
    });
  }
}

/**
 * Handle the WAIT command
 * @param {net.Socket} clientConn - The client connection that issued the WAIT command
 * @param {number} numReplicas - Number of replicas to wait for
 * @param {number} timeout - Timeout in milliseconds
 */
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
      clientConn.write(encodeInteger(acked));
      clearTimeout(timer);
      pendingWAITs = pendingWAITs.filter((w) => w !== waitObj);
    }
  }

  // Immediate resolve if enough already
  if (countAcks() >= numReplicas) {
    clientConn.write(encodeInteger(countAcks()));
    return;
  }

  // Else, push pending WAIT
  let timer = setTimeout(() => {
    if (!resolved) {
      let acked = countAcks();
      clientConn.write(encodeInteger(acked));
      resolved = true;
      pendingWAITs = pendingWAITs.filter((w) => w !== waitObj);
    }
  }, timeout);

  const waitObj = { waitOffset, numReplicas, clientConn, timer, maybeResolve };
  pendingWAITs.push(waitObj);
}

/**
 * Resolve any pending WAIT commands that have been satisfied
 */
function resolveWAITs() {
  pendingWAITs.forEach((w) => w.maybeResolve());
}

/**
 * Handle replica disconnection
 * @param {net.Socket} connection - The socket connection that disconnected
 */
function handleReplicaDisconnection(connection) {
  if (connection.isReplica) {
    replicaSockets = replicaSockets.filter((sock) => sock !== connection);
    resolveWAITs();
  }
}

/**
 * Get replication info for INFO command
 * @param {string} role - The server role (master/slave)
 * @returns {string} Replication info string
 */
function getReplicationInfo(role) {
  let lines = [`role:${role}`];
  if (role === 'master') {
    lines.push(`master_replid:${MASTER_REPL_ID}`);
    lines.push(`master_repl_offset:${masterOffset}`);
  }
  return lines.join('\r\n');
}

module.exports = {
  handleNewReplica,
  handleReplicaAck,
  propagateCommand,
  handleWAITCommand,
  handleReplicaDisconnection,
  getReplicationInfo,
  replicaSockets,
  masterOffset
};