/**
 * Replica handshake process implementation
 */

const net = require('net');
const { tryParseRESP } = require('../protocol/resp');
const { HANDSHAKE_STAGES } = require('../config/constants');
const store = require('../storage/store');

/**
 * Initialize a connection to the master server
 * @param {Object} config - Server configuration
 * @param {Function} callback - Callback to run when connection is established
 */
function connectToMaster(config, callback) {
  let handshakeStep = HANDSHAKE_STAGES.INITIAL;
  let awaitingRDB = false;
  let rdbBytesExpected = 0;
  let leftover = Buffer.alloc(0); // Buffer for command data
  let masterOffset = 0;

  const masterConnection = net.createConnection(config.masterPort, config.masterHost, () => {
    masterConnection.write("*1\r\n$4\r\nPING\r\n");
  });

  masterConnection.on('data', (data) => {
    if (handshakeStep === HANDSHAKE_STAGES.INITIAL) {
      const portStr = config.port.toString();
      masterConnection.write(
        `*3\r\n$8\r\nREPLCONF\r\n$14\r\nlistening-port\r\n$${portStr.length}\r\n${portStr}\r\n`
      );
      handshakeStep = HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT;
      return;
    } else if (handshakeStep === HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT) {
      masterConnection.write(
        "*3\r\n$8\r\nREPLCONF\r\n$4\r\ncapa\r\n$6\r\npsync2\r\n"
      );
      handshakeStep = HANDSHAKE_STAGES.REPLCONF_CAPA;
      return;
    } else if (handshakeStep === HANDSHAKE_STAGES.REPLCONF_CAPA) {
      masterConnection.write("*3\r\n$5\r\nPSYNC\r\n$1\r\n?\r\n$2\r\n-1\r\n");
      handshakeStep = HANDSHAKE_STAGES.PSYNC;
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

  masterConnection.on('error', (err) => {
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
        const ackResp = `*3\r\n$8\r\nREPLCONF\r\n$3\r\nACK\r\n$${masterOffset.toString().length}\r\n${masterOffset}\r\n`;
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
      if (cmdArr.length >= 5 && cmdArr[3].toLowerCase() === "px") {
        const px = parseInt(cmdArr[4], 10);
        expiresAt = Date.now() + px;
      }
      store.set(key, value, expiresAt, 'string');
    }
    // Add more command handlers as needed
  }

  // Return the connection for external use
  if (callback) {
    callback(masterConnection);
  }
  
  return masterConnection;
}

module.exports = {
  connectToMaster
};