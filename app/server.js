// server.js
// Main entry point for the Redis server

const net = require('net');

// Import configuration
const { parseArguments } = require('./config/config-parser');
const { ROLES } = require('./config/constants');

// Import protocol handling
const { parseRESP, serialize } = require('./protocol/resp');

// Import storage
const { loadData } = require('./storage/rdb-loader');

// Import replication
const ReplicaManager = require('./replication/replica-manager');
const ReplicaHandshake = require('./replication/replica-handshake');

// Import command handling
const CommandHandler = require('./commands/command-handler');

/**
 * Main server function
 */
async function main() {
  // Parse command line arguments
  const config = parseArguments();
  console.log("Parsed config:", config);

  // Load data from RDB file
  loadData(config);

  // Create replica manager (only used by master)
  const replicaManager = new ReplicaManager();

  // Create command handler
  const commandHandler = new CommandHandler(config, replicaManager);

  // Start server
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
      const handshake = new ReplicaHandshake(config, commandHandler);
      // Start handshake in background
      setImmediate(() => handshake.start());
    }
  });
}

// Start the server
main().catch(console.error);