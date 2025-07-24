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
  let buffer = '';
  let rdbMode = false;
  let rdbLength = 0;
  let rdbBytesRead = 0;
  
  client.on('data', (data) => {
    try {
      // Add new data to buffer
      buffer += data.toString();
      
      // Check for REPLCONF GETACK in the buffer, even during RDB transfer
      const getAckResult = checkForGetAckCommand(buffer, client);
      buffer = getAckResult.buffer;
      
      // If we're in RDB transfer mode, handle it differently
      if (rdbMode) {
        // If we haven't parsed the RDB length yet, try to do so
        if (rdbLength === 0 && buffer.startsWith('$')) {
          const endOfLength = buffer.indexOf('\r\n');
          if (endOfLength !== -1) {
            rdbLength = parseInt(buffer.substring(1, endOfLength), 10);
            buffer = buffer.substring(endOfLength + 2);
            console.log(`RDB length: ${rdbLength}`);
            
            // Check for REPLCONF GETACK again after parsing length
            const getAckResult2 = checkForGetAckCommand(buffer, client);
            buffer = getAckResult2.buffer;
          }
          return;
        }
        
        // If we're still receiving RDB data
        if (buffer.length < rdbLength - rdbBytesRead) {
          rdbBytesRead += buffer.length;
          buffer = '';
          return;
        }
        
        // We've received all RDB data
        const remainingBytes = rdbLength - rdbBytesRead;
        if (remainingBytes > 0) {
          // Consume the remaining RDB bytes
          buffer = buffer.substring(remainingBytes);
          rdbBytesRead += remainingBytes;
        }
        
        // RDB transfer complete
        console.log('RDB transfer complete');
        rdbMode = false;
        
        // Check for REPLCONF GETACK again after RDB transfer
        const getAckResult3 = checkForGetAckCommand(buffer, client);
        buffer = getAckResult3.buffer;
      }
      
      // Parse regular commands
      if (!rdbMode) {
        // Check for REPLCONF GETACK one more time before parsing
        const finalGetAckResult = checkForGetAckCommand(buffer, client);
        buffer = finalGetAckResult.buffer;
        
        // Parse data into separate commands
        const requests = parseEvents(buffer);
        buffer = ''; // Clear buffer after parsing
        
        for (const request of requests) {
          // Skip non-command data
          if (!request.startsWith('*')) continue;
          
          try {
            // Parse command
            const parsedRequest = parseRESP(request);
            const command = parsedRequest[0].toUpperCase();
            const args = parsedRequest.slice(1);
            
            // Check for FULLRESYNC to enter RDB mode
            if (command === 'FULLRESYNC') {
              console.log('Received FULLRESYNC, entering RDB mode');
              rdbMode = true;
              rdbLength = 0;
              rdbBytesRead = 0;
              continue;
            }
            
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
 * Check for and handle REPLCONF GETACK commands in the buffer
 * @param {string} buffer - Current data buffer
 * @param {net.Socket} client - Connection to master
 * @returns {object} - Object with modified buffer and boolean indicating if GETACK was found
 */
function checkForGetAckCommand(buffer, client) {
  // First, try to find a complete RESP array command for REPLCONF GETACK
  let index = -1;
  
  // Try to find the start of a command
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === '*') {
      // Check if this could be a REPLCONF GETACK command
      const possibleCmd = buffer.substring(i);
      
      // Check if it has the right number of arguments (3 for REPLCONF GETACK *)
      if (possibleCmd.startsWith('*3\r\n')) {
        // Try to extract the command name
        const cmdNameMatch = possibleCmd.match(/\*3\r\n\$\d+\r\n([Rr][Ee][Pp][Ll][Cc][Oo][Nn][Ff])\r\n/i);
        
        if (cmdNameMatch) {
          // Check for GETACK subcommand
          const getackMatch = possibleCmd.match(/\$\d+\r\n([Gg][Ee][Tt][Aa][Cc][Kk])\r\n/i);
          
          if (getackMatch) {
            // We found a REPLCONF GETACK command
            index = i;
            break;
          }
        }
      }
    }
  }
  
  if (index !== -1) {
    console.log('Found REPLCONF GETACK command during data processing');
    client.write(serializeRESP.array(['REPLCONF', 'ACK', '0']));
    
    // Find the end of the command (the third argument)
    const cmdStart = index;
    let cmdEnd = buffer.indexOf('\r\n', index);
    
    // Skip to the end of the command (after the third argument)
    let argCount = 0;
    let currentPos = cmdEnd + 2; // Skip *3\r\n
    while (argCount < 3 && currentPos < buffer.length) {
      // Find the bulk string marker
      if (buffer[currentPos] !== '$') break;
      
      // Find the end of the length
      const lenEnd = buffer.indexOf('\r\n', currentPos);
      if (lenEnd === -1) break;
      
      // Parse the length
      const len = parseInt(buffer.substring(currentPos + 1, lenEnd), 10);
      if (isNaN(len)) break;
      
      // Skip to the end of this argument
      currentPos = lenEnd + 2 + len + 2; // Skip $len\r\n + content + \r\n
      argCount++;
    }
    
    if (argCount === 3) {
      // We've found the complete command, remove it from the buffer
      const newBuffer = buffer.substring(0, cmdStart) + buffer.substring(currentPos);
      return { buffer: newBuffer, found: true };
    }
  }
  
  return { buffer, found: false };
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