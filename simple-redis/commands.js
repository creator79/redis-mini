// commands.js - Simple Redis command handlers
const { serializeRESP } = require('./protocol');
const path = require('path');
const fs = require('fs');

/**
 * Handle Redis commands
 * @param {string[]} args - Command arguments
 * @param {net.Socket} client - Client connection
 * @param {Map} store - Key-value store
 * @param {Map} expiryTimes - Key expiry times
 * @param {Object} config - Server configuration
 * @returns {string|null} - Response to send to client
 */
function handleCommand(args, client, store, expiryTimes, config) {
  // Check for empty command
  if (!args || args.length === 0) {
    return serializeRESP.error('ERR empty command');
  }
  
  // Get command name (case-insensitive)
  const command = args[0].toUpperCase();
  
  // Handle commands
  switch (command) {
    case 'PING':
      return handlePing();
      
    case 'ECHO':
      return handleEcho(args);
      
    case 'SET':
      return handleSet(args, store, expiryTimes, config, client);
      
    case 'GET':
      return handleGet(args, store, expiryTimes);
      
    case 'CONFIG':
      return handleConfig(args, config);
      
    case 'KEYS':
      return handleKeys(args, store, expiryTimes);
      
    case 'INFO':
      return handleInfo(args, config);
      
    case 'REPLCONF':
      return handleReplconf(args, client, config);
      
    case 'PSYNC':
      return handlePsync(args, client, config);
      
    default:
      return serializeRESP.error(`ERR unknown command '${command}'`);
  }
}

/**
 * Handle PING command
 */
function handlePing() {
  return serializeRESP.simple('PONG');
}

/**
 * Handle ECHO command
 */
function handleEcho(args) {
  if (args.length < 2) {
    return serializeRESP.error('ERR wrong number of arguments for ECHO');
  }
  return serializeRESP.bulk(args[1]);
}

/**
 * Handle SET command
 */
function handleSet(args, store, expiryTimes, config, client) {
  if (args.length < 3) {
    return serializeRESP.error('ERR wrong number of arguments for SET');
  }
  
  const key = args[1];
  const value = args[2];
  let expiryTime = null;
  
  // Parse expiry time
  for (let i = 3; i < args.length; i += 2) {
    if (i + 1 >= args.length) break;
    
    const option = args[i].toUpperCase();
    const optionValue = args[i + 1];
    
    if (option === 'PX') {
      const ms = parseInt(optionValue, 10);
      if (isNaN(ms)) {
        return serializeRESP.error('ERR invalid PX value');
      }
      expiryTime = Date.now() + ms;
    }
  }
  
  // Store value
  store.set(key, value);
  
  // Set expiry time if provided
  if (expiryTime !== null) {
    expiryTimes.set(key, expiryTime);
  } else {
    expiryTimes.delete(key);
  }
  
  // Propagate to replicas if master
  if (config.role === 'master' && client) {
    // In a real implementation, we would propagate to replicas here
  }
  
  return serializeRESP.simple('OK');
}

/**
 * Handle GET command
 */
function handleGet(args, store, expiryTimes) {
  if (args.length !== 2) {
    return serializeRESP.error('ERR wrong number of arguments for GET');
  }
  
  const key = args[1];
  
  // Check if key exists
  if (!store.has(key)) {
    return serializeRESP.bulk(null);
  }
  
  // Check if key has expired
  const expiryTime = expiryTimes.get(key);
  if (expiryTime && Date.now() > expiryTime) {
    store.delete(key);
    expiryTimes.delete(key);
    return serializeRESP.bulk(null);
  }
  
  return serializeRESP.bulk(store.get(key));
}

/**
 * Handle CONFIG command
 */
function handleConfig(args, config) {
  if (args.length < 2) {
    return serializeRESP.error('ERR wrong number of arguments for CONFIG');
  }
  
  const subcommand = args[1].toUpperCase();
  
  if (subcommand === 'GET') {
    if (args.length !== 3) {
      return serializeRESP.error('ERR wrong number of arguments for CONFIG GET');
    }
    
    const param = args[2].toLowerCase();
    
    if (param === 'dir') {
      return serializeRESP.array([param, config.dir]);
    } else if (param === 'dbfilename') {
      return serializeRESP.array([param, config.dbfilename]);
    } else {
      return serializeRESP.array([]);
    }
  }
  
  return serializeRESP.error(`ERR unknown CONFIG subcommand ${subcommand}`);
}

/**
 * Handle KEYS command
 */
function handleKeys(args, store, expiryTimes) {
  if (args.length !== 2) {
    return serializeRESP.error('ERR wrong number of arguments for KEYS');
  }
  
  const pattern = args[1];
  const keys = [];
  
  // Simple pattern matching (only supports * wildcard)
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  
  // Get all keys that match pattern and haven't expired
  for (const key of store.keys()) {
    // Check if key has expired
    const expiryTime = expiryTimes.get(key);
    if (expiryTime && Date.now() > expiryTime) {
      store.delete(key);
      expiryTimes.delete(key);
      continue;
    }
    
    // Check if key matches pattern
    if (regex.test(key)) {
      keys.push(key);
    }
  }
  
  return serializeRESP.array(keys);
}

/**
 * Handle INFO command
 */
function handleInfo(args, config) {
  let section = 'server';
  
  if (args.length > 1) {
    section = args[1].toLowerCase();
  }
  
  let info = '';
  
  if (section === 'replication') {
    info += `role:${config.role}\r\n`;
    
    if (config.role === 'master') {
      info += 'master_replid:8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb\r\n';
      info += 'master_repl_offset:0\r\n';
    } else {
      info += `master_host:${config.masterHost}\r\n`;
      info += `master_port:${config.masterPort}\r\n`;
    }
  }
  
  return serializeRESP.bulk(info);
}

/**
 * Handle REPLCONF command
 */
function handleReplconf(args, client, config) {
  if (args.length < 2) {
    return serializeRESP.error('ERR wrong number of arguments for REPLCONF');
  }
  
  const subcommand = args[1].toUpperCase();
  
  if (subcommand === 'GETACK') {
    // Master is asking for acknowledgement
    if (config.role === 'slave' && client) {
      // Send ACK response
      client.write(serializeRESP.array(['REPLCONF', 'ACK', '0']));
      return null; // No response needed as we already sent one
    }
  } else if (subcommand === 'LISTENING-PORT' || subcommand === 'CAPA') {
    // These are part of the handshake
    return serializeRESP.simple('OK');
  }
  
  return serializeRESP.simple('OK');
}

/**
 * Handle PSYNC command
 */
function handlePsync(args, client, config) {
  if (config.role !== 'master') {
    return serializeRESP.error('ERR not a master');
  }
  
  // Send FULLRESYNC response
  return serializeRESP.simple('FULLRESYNC 8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb 0');
}

module.exports = {
  handleCommand
};