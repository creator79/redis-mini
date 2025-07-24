// main.js - Entry point for Simple Redis server
const net = require('net');
const { parseConfig } = require('./config');
const { serializeRESP, parseRESP, parseEvents } = require('./protocol');
const { handleCommand } = require('./commands');
const { connectToMaster } = require('./replication');

// Parse command line arguments
const config = parseConfig(process.argv.slice(2));

// Global state
const store = new Map(); // Key-value store
const expiryTimes = new Map(); // Key expiry times

// Create server
const server = net.createServer((client) => {
  console.log('Client connected');
  
  // Buffer for incoming data
  let buffer = '';
  
  // Handle client data
  client.on('data', (data) => {
    try {
      // Add new data to buffer
      buffer += data.toString();
      
      // Parse data into separate commands
      const requests = parseEvents(buffer);
      buffer = buffer.substring(requests.join('').length); // Remove processed data from buffer
      
      // Process each command
      for (const request of requests) {
        // Skip non-command data
        if (!request.startsWith('*')) continue;
        
        try {
          // Parse command
          const args = parseRESP(request);
          
          // Handle command
          const response = handleCommand(args, client, store, expiryTimes, config);
          
          // Send response if needed
          if (response) {
            client.write(response);
          }
        } catch (err) {
          console.error('Error processing command:', err.message);
          client.write(serializeRESP.error(`ERR ${err.message}`));
        }
      }
    } catch (err) {
      console.error('Error processing data:', err.message);
      client.write(serializeRESP.error(`ERR ${err.message}`));
    }
  });
  
  // Handle client disconnect
  client.on('end', () => {
    console.log('Client disconnected');
  });
  
  // Handle client errors
  client.on('error', (err) => {
    console.error('Client error:', err.message);
  });
});

// Start server
server.listen(config.port, () => {
  console.log(`Redis server listening on port ${config.port}`);
  console.log(`Server role: ${config.role}`);
  
  // Connect to master if we're a replica
  if (config.role === 'slave') {
    console.log(`Master: ${config.masterHost}:${config.masterPort}`);
    connectToMaster(config, store, expiryTimes);
  }
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

// Periodically check for expired keys
setInterval(() => {
  const now = Date.now();
  
  for (const [key, expiryTime] of expiryTimes.entries()) {
    if (now > expiryTime) {
      store.delete(key);
      expiryTimes.delete(key);
    }
  }
}, 100); // Check every 100ms