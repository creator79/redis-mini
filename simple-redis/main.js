// main.js - Simple Redis Server Implementation
const net = require('net');
const fs = require('fs');
const path = require('path');

// Import utility functions
const { parseRESP, serializeRESP } = require('./protocol');
const { parseConfig } = require('./config');
const { handleCommand } = require('./commands');
const { connectToMaster } = require('./replication');

// Global state
const store = new Map(); // In-memory key-value store
const expiryTimes = new Map(); // Key expiry times

// Parse command line arguments
const config = parseConfig(process.argv.slice(2));

// Create server
const server = net.createServer((client) => {
  console.log('Client connected');
  
  client.on('data', (data) => {
    try {
      // Parse RESP data
      const args = parseRESP(data.toString());
      
      // Handle command and get response
      const response = handleCommand(args, client, store, expiryTimes, config);
      
      // Send response if not null
      if (response !== null) {
        client.write(response);
      }
    } catch (err) {
      console.error('Error handling command:', err.message);
      client.write(serializeRESP.error('ERR ' + err.message));
    }
  });
  
  client.on('error', (err) => {
    console.error('Client error:', err.message);
  });
  
  client.on('end', () => {
    console.log('Client disconnected');
  });
});

// Start server
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Redis server listening on port ${config.port}`);
  
  // If this is a replica, connect to master
  if (config.role === 'slave') {
    connectToMaster(config, store, expiryTimes);
  }
});