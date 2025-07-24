// config-parser.js
// Handles parsing command line arguments to configure the Redis server

const { DEFAULT_CONFIG, ROLES } = require('./constants');

/**
 * Parse command line arguments to configure the Redis server
 * @returns {Object} - The server configuration
 */
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

module.exports = {
  parseArguments
};