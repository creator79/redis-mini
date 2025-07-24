# Simple Redis Implementation

This is a simplified Redis server implementation designed to be easy to understand for beginners with basic JavaScript knowledge.

## Features

- Basic Redis commands (PING, ECHO, SET, GET, CONFIG, KEYS, INFO)
- Master-replica replication
- Key expiration
- RESP (Redis Serialization Protocol) encoding/decoding

## Project Structure

- **main.js**: Entry point that sets up the server and handles client connections
- **protocol.js**: Handles RESP encoding and decoding
- **config.js**: Parses command-line arguments
- **commands.js**: Implements Redis commands
- **replication.js**: Handles master-replica communication

## How to Run

### As a Master

```bash
node main.js --port 6379
```

### As a Replica

```bash
node main.js --port 6380 --replicaof 127.0.0.1 6379
```

## Code Design

This implementation uses a functional approach rather than a class-based approach to make the code easier to understand. Each file has a specific responsibility:

1. **main.js**: Sets up the server and connects the different components
2. **protocol.js**: Provides functions for encoding and decoding RESP data
3. **config.js**: Parses command-line arguments into a configuration object
4. **commands.js**: Contains functions for handling different Redis commands
5. **replication.js**: Manages the connection to a master server and processes replication commands

## REPLCONF GETACK Implementation

The `REPLCONF GETACK` command is handled in the `replication.js` file. When a master sends this command, the replica responds with `REPLCONF ACK 0` to acknowledge the command.

```javascript
// Handle REPLCONF GETACK command
if (command === 'REPLCONF' && args[0].toUpperCase() === 'GETACK') {
  console.log('Received REPLCONF GETACK from master');
  client.write(serializeRESP.array(['REPLCONF', 'ACK', '0']));
  continue;
}
```

This implementation is simple and straightforward, making it easy to understand how the replica responds to the master's commands.