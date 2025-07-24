// replication.js - Simple Redis replication
const net = require('net');
const { serializeRESP, parseRESP, parseEvents } = require('./protocol');

/**
 * Connect to master server as a replica
 * @param {Object} config - Server configuration
 * @param {Map} store - Key-value store
 * @param {Map} expiryTimes - Key expiry times
 */
function connectToMaster(config, store, expiryTimes) {
  console.log(`Connecting to master at ${config.masterHost}:${config.masterPort}`);
  
  // Create connection to master
  const client = net.createConnection({
    host: config.masterHost,
    port: config.masterPort
  }, () => {
    console.log('Connected to master');
    
    // Start handshake
    performHandshake(client, config);
  });
  
  // Handle data from master
  client.on('data', (data) => {
    try {
      // Parse data into separate commands
      const requests = parseEvents(data.toString());
      
      for (const request of requests) {
        // Skip non-command data
        if (!request.startsWith('*')) continue;
        
        try {
          // Parse command
          const parsedRequest = parseRESP(request);
          const command = parsedRequest[0].toUpperCase();
          const args = parsedRequest.slice(1);
          
          // Handle REPLCONF GETACK command
          if (command === 'REPLCONF' && args[0].toUpperCase() === 'GETACK') {
            console.log('Received REPLCONF GETACK from master');
            client.write(serializeRESP.array(['REPLCONF', 'ACK', '0']));
            continue;
          }
          
          // Handle other commands (like SET)
          handleMasterCommand(command, args, store, expiryTimes);
        } catch (err) {
          console.error('Error parsing command:', err.message);
        }
      }
    } catch (err) {
      console.error('Error processing data from master:', err.message);
    }
  });
  
  // Handle connection errors
  client.on('error', (err) => {
    console.error('Connection to master error:', err.message);
    
    // Try to reconnect after a delay
    setTimeout(() => {
      connectToMaster(config, store, expiryTimes);
    }, 5000);
  });
  
  // Handle connection close
  client.on('close', () => {
    console.log('Connection to master closed');
    
    // Try to reconnect after a delay
    setTimeout(() => {
      connectToMaster(config, store, expiryTimes);
    }, 5000);
  });
  
  return client;
}

/**
 * Perform handshake with master
 * @param {net.Socket} client - Connection to master
 * @param {Object} config - Server configuration
 */
function performHandshake(client, config) {
  console.log('Starting handshake with master');
  
  // Send PING
  console.log('Sending PING');
  client.write(serializeRESP.array(['PING']));
  
  // Send REPLCONF listening-port
  console.log('Sending REPLCONF listening-port');
  client.write(serializeRESP.array(['REPLCONF', 'listening-port', config.port.toString()]));
  
  // Send REPLCONF capa
  console.log('Sending REPLCONF capa');
  client.write(serializeRESP.array(['REPLCONF', 'capa', 'psync2']));
  
  // Send PSYNC
  console.log('Sending PSYNC');
  client.write(serializeRESP.array(['PSYNC', '?', '-1']));
}

/**
 * Handle commands from master
 * @param {string} command - Command name
 * @param {string[]} args - Command arguments
 * @param {Map} store - Key-value store
 * @param {Map} expiryTimes - Key expiry times
 */
function handleMasterCommand(command, args, store, expiryTimes) {
  console.log(`Received command from master: ${command}`);
  
  // Handle SET command
  if (command === 'SET') {
    if (args.length < 2) return;
    
    const key = args[0];
    const value = args[1];
    let expiryTime = null;
    
    // Parse expiry time
    for (let i = 2; i < args.length; i += 2) {
      if (i + 1 >= args.length) break;
      
      const option = args[i].toUpperCase();
      const optionValue = args[i + 1];
      
      if (option === 'PX') {
        const ms = parseInt(optionValue, 10);
        if (!isNaN(ms)) {
          expiryTime = Date.now() + ms;
        }
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
  }
  
  // Handle other commands as needed
}

module.exports = {
  connectToMaster
};