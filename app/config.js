// config.js - Simple configuration parser

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  dir: '.',
  dbfilename: 'dump.rdb',
  port: 6379,
  role: 'master',
  masterHost: null,
  masterPort: null
};

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} - Configuration object
 */
function parseConfig(args) {
  // Start with default config
  const config = { ...DEFAULT_CONFIG };
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--dir':
        if (i + 1 < args.length) {
          config.dir = args[++i];
        }
        break;
        
      case '--dbfilename':
        if (i + 1 < args.length) {
          config.dbfilename = args[++i];
        }
        break;
        
      case '--port':
        if (i + 1 < args.length) {
          config.port = parseInt(args[++i], 10);
        }
        break;
        
      case '--replicaof':
        if (i + 2 < args.length) {
          config.role = 'slave';
          config.masterHost = args[++i];
          config.masterPort = parseInt(args[++i], 10);
        }
        break;
    }
  }
  
  return config;
}

module.exports = {
  parseConfig
};