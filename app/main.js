/**
 * Main entry point for the Redis server
 */

const { parseConfig } = require('./config/config-parser');
const { createServer } = require('./server');
const { ROLES } = require('./config/constants');
const { initRDBLoader } = require('./storage/rdb-loader');
const replicaHandshake = require('./replication/replica-handshake');

// Parse command line arguments
const config = parseConfig(process.argv);

// Initialize the server based on role
if (config.role === ROLES.MASTER) {
  console.log('Starting server in MASTER mode');
  
  // Initialize RDB loader if needed
  initRDBLoader(config);
  
  // Create and start the server
  createServer(config);
} else if (config.role === ROLES.REPLICA) {
  console.log('Starting server in REPLICA mode');
  console.log(`Connecting to master at ${config.masterHost}:${config.masterPort}`);
  
  // Initialize RDB loader if needed
  initRDBLoader(config);
  
  // Create and start the server
  const server = createServer(config);
  
  // Connect to master and start replica handshake
  replicaHandshake.connectToMaster(config, server);
}