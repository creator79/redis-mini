/**
 * Parses command-line arguments for the Redis server
 */

const { ROLES } = require('./constants');

/**
 * Parse command-line arguments into a configuration object
 * @param {string[]} args - Command-line arguments
 * @returns {Object} Configuration object
 */
function parseConfig(args) {
  const config = {
    dir: '',
    dbfilename: '',
    port: 6379,
    role: ROLES.MASTER,
    masterHost: null,
    masterPort: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && i + 1 < args.length) {
      config.dir = args[i + 1];
    }
    if (args[i] === '--dbfilename' && i + 1 < args.length) {
      config.dbfilename = args[i + 1];
    }
    if (args[i] === '--port' && i + 1 < args.length) {
      config.port = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--replicaof' && i + 1 < args.length) {
      config.role = ROLES.SLAVE;
      const [host, portStr] = args[i + 1].split(' ');
      config.masterHost = host;
      config.masterPort = parseInt(portStr, 10);
    }
  }

  return config;
}

module.exports = { parseConfig };