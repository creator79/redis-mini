/**
 * Server setup and connection handling
 */

const net = require('net');
const { parseRESP } = require('./protocol/resp');
const { handleCommand } = require('./commands/command-handler');
const replicaManager = require('./replication/replica-manager');

/**
 * Create and start the Redis server
 * @param {Object} config - Server configuration
 * @returns {net.Server} The server instance
 */
function createServer(config) {
  const server = net.createServer((connection) => {
    // Initialize connection properties
    connection.isReplica = false; // Mark whether this socket is a replica
    connection.lastAckOffset = 0; // Used for replicas, tracks last ACK offset

    // Handle incoming data
    connection.on('data', (data) => {
      // Log what the server receives
      console.log(`Server received: ${data.toString()}`);

      // Parse RESP data
      const cmdArr = parseRESP(data);
      
      // Handle the command
      const response = handleCommand(connection, cmdArr, config);
      
      // Send response if not null (some commands handle their own responses)
      if (response) {
        connection.write(response);
      }
    });

    // Handle connection errors
    connection.on('error', (err) => {
      console.log('Socket error:', err.message);
    });

    // Handle connection close
    connection.on('close', () => {
      // Clean up replica connections
      replicaManager.handleReplicaDisconnection(connection);
    });
  });

  // Start listening
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Redis server listening on port ${config.port}`);
  });

  return server;
}

module.exports = { createServer };