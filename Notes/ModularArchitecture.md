# Redis Server Modular Architecture

## Overview

This document outlines the modular architecture implemented for our Redis server. The codebase has been reorganized to improve maintainability, readability, and extensibility by separating concerns into distinct modules based on Redis features and functionality.

## Directory Structure

```
app/
├── config/
│   ├── constants.js       # Centralized constants and enums
│   └── config-parser.js   # Command-line argument parsing
├── protocol/
│   └── resp.js            # Redis Serialization Protocol implementation
├── storage/
│   ├── store.js           # In-memory key-value store
│   └── rdb-loader.js      # RDB file loading and parsing
├── replication/
│   ├── replica-manager.js # Replica management and WAIT command
│   └── replica-handshake.js # Replica handshake process
├── commands/
│   └── command-handler.js # Command dispatching and handling
├── server.js              # Server setup and connection handling
└── main.js                # Entry point
```

## Module Descriptions

### Config

- **constants.js**: Centralizes all constants and enums used throughout the application, such as roles (MASTER/SLAVE), handshake stages, commands, and default configuration.
- **config-parser.js**: Handles parsing of command-line arguments like `--dir`, `--dbfilename`, `--port`, and `--replicaof` into a configuration object.

### Protocol

- **resp.js**: Implements the Redis Serialization Protocol (RESP) with functions for serializing different data types (simple strings, errors, bulk strings, arrays, integers) and parsing raw RESP data.

### Storage

- **store.js**: Provides an in-memory key-value store with methods for setting, getting, and deleting keys, with support for key expiration.
- **rdb-loader.js**: Handles loading data from RDB files, parsing the hexadecimal content, and storing key-value pairs in the in-memory store.

### Replication

- **replica-manager.js**: Manages replica connections, propagates commands to replicas, tracks replica offsets, and implements the WAIT command logic.
- **replica-handshake.js**: Handles the handshake process for a replica connecting to a master, including stages like PING, REPLCONF, PSYNC, and RDB transfer.

### Commands

- **command-handler.js**: Dispatches Redis commands to their respective handler methods, implementing functionality for commands like PING, ECHO, SET, GET, CONFIG, KEYS, INFO, REPLCONF, PSYNC, and WAIT.

### Server

- **server.js**: Sets up the TCP server, handles client connections, parses incoming RESP commands, dispatches them to the command handler, and manages disconnections.
- **main.js**: Simple entry point that imports and runs the server.

## Benefits of This Architecture

1. **Separation of Concerns**: Each module has a specific responsibility, making the code easier to understand and maintain.
2. **Modularity**: Features are isolated in their own modules, allowing for easier testing and extension.
3. **Reusability**: Common functionality is centralized and can be reused across different parts of the application.
4. **Scalability**: New features can be added by creating new modules or extending existing ones without modifying the core functionality.
5. **Readability**: The codebase is more organized and follows a clear structure, making it easier for new developers to understand.

## Future Extensions

This modular architecture makes it easier to add new Redis features in the future, such as:

1. **Persistence**: Adding AOF (Append-Only File) persistence alongside RDB snapshots.
2. **Data Structures**: Implementing additional Redis data structures like lists, sets, hashes, and sorted sets.
3. **Transactions**: Adding support for Redis transactions with MULTI/EXEC commands.
4. **Pub/Sub**: Implementing the publish/subscribe messaging paradigm.
5. **Lua Scripting**: Adding support for Lua scripting with the EVAL command.