// replica-handshake.js
// Handles the handshake process for replica instances connecting to a master

const net = require('net');
const { HANDSHAKE_STAGES, COMMANDS, ROLES } = require('../config/constants');
const { serialize } = require('../protocol/resp');

/**
 * Manages the handshake process for a replica connecting to a master
 */
class ReplicaHandshake {
  /**
   * Create a new ReplicaHandshake instance
   * @param {Object} config - Server configuration
   * @param {Object} commandHandler - Command handler instance
   */
  constructor(config, commandHandler) {
    this.config = config;
    this.commandHandler = commandHandler;
    this.currentStage = HANDSHAKE_STAGES.PING;
    this.connection = null;
    this.pendingResolve = null;
    this.buffer = '';
    this.replicationMode = false;
    this.rdbProcessed = false;
    this.rdbExpectedLength = 0;
  }

  /**
   * Start the handshake process
   */
  async start() {
    if (this.config.role !== ROLES.SLAVE) {
      console.log("Not a slave, skipping handshake");
      return;
    }

    console.log(
      `Starting handshake with master at ${this.config.masterHost}:${this.config.masterPort}`
    );

    try {
      await this.connectToMaster();
      await this.executeHandshake();
      this.replicationMode = true;
    } catch (error) {
      console.error("Handshake failed:", error.message);
      if (this.connection) {
        this.connection.destroy();
      }
    }
  }

  /**
   * Connect to the master server
   * @returns {Promise} - Resolves when connected
   */
  connectToMaster() {
    return new Promise((resolve, reject) => {
      this.connection = net.createConnection(
        this.config.masterPort,
        this.config.masterHost,
        () => {
          console.log("Connected to master");
          resolve();
        }
      );

      this.connection.on("error", (error) => {
        console.error("Connection error:", error.message);
        reject(error);
      });

      this.connection.on("data", (data) => {
        this.buffer += data.toString();
        if (this.replicationMode) {
          this.processReplicationBuffer();
        } else {
          this.handleMasterResponse();
        }
      });

      this.connection.on("close", () => {
        console.log("Connection to master closed");
      });
    });
  }

  /**
   * Execute the handshake sequence
   */
  async executeHandshake() {
    console.log("Starting handshake sequence");

    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.PING);
    await this.sendCommandAndWaitForResponse(
      HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT
    );
    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.REPLCONF_CAPA);
    await this.sendCommandAndWaitForResponse(HANDSHAKE_STAGES.PSYNC);

    console.log("Handshake completed successfully");
    this.currentStage = HANDSHAKE_STAGES.COMPLETED;
  }

  /**
   * Send a command and wait for a response
   * @param {string} stage - The handshake stage
   * @returns {Promise} - Resolves when a response is received
   */
  sendCommandAndWaitForResponse(stage) {
    return new Promise((resolve, reject) => {
      this.currentStage = stage;
      this.pendingResolve = resolve;

      switch (stage) {
        case HANDSHAKE_STAGES.PING:
          this.sendPing();
          break;
        case HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT:
          this.sendReplconfListeningPort();
          break;
        case HANDSHAKE_STAGES.REPLCONF_CAPA:
          this.sendReplconfCapa();
          break;
        case HANDSHAKE_STAGES.PSYNC:
          this.sendPsync();
          break;
        default:
          reject(new Error(`Unknown stage: ${stage}`));
      }

      setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          reject(new Error(`Timeout waiting for response in stage: ${stage}`));
        }
      }, 5000);
    });
  }

  /**
   * Send a PING command to the master
   */
  sendPing() {
    console.log("Sending PING to master");
    const command = serialize.array([COMMANDS.PING]);
    this.connection.write(command);
  }

  /**
   * Send a REPLCONF listening-port command to the master
   */
  sendReplconfListeningPort() {
    console.log("Sending REPLCONF listening-port to master");
    const command = serialize.array([
      COMMANDS.REPLCONF,
      "listening-port",
      this.config.port.toString(),
    ]);
    this.connection.write(command);
  }

  /**
   * Send a REPLCONF capa command to the master
   */
  sendReplconfCapa() {
    console.log("Sending REPLCONF capa to master");
    const command = serialize.array([COMMANDS.REPLCONF, "capa", "psync2"]);
    this.connection.write(command);
  }

  /**
   * Send a PSYNC command to the master
   */
  sendPsync() {
    console.log("Sending PSYNC to master");
    const command = serialize.array([COMMANDS.PSYNC, "?", "-1"]);
    this.connection.write(command);
  }

  /**
   * Handle responses from the master during handshake
   */
  handleMasterResponse() {
    while (this.buffer.includes('\r\n')) {
      let responseEnd = this.buffer.indexOf('\r\n');
      let response = this.buffer.substring(0, responseEnd + 2);
      this.buffer = this.buffer.substring(responseEnd + 2);
      
      console.log(`Received from master (${this.currentStage}):`, response.trim());

      switch (this.currentStage) {
        case HANDSHAKE_STAGES.PING:
        case HANDSHAKE_STAGES.REPLCONF_LISTENING_PORT:
        case HANDSHAKE_STAGES.REPLCONF_CAPA:
          if (response.includes("OK") || response.includes("PONG")) {
            if (this.pendingResolve) {
              this.pendingResolve();
              this.pendingResolve = null;
            }
          }
          break;

        case HANDSHAKE_STAGES.PSYNC:
          if (response.includes("FULLRESYNC")) {
            console.log("Full resync initiated");
            this.currentStage = HANDSHAKE_STAGES.RDB_TRANSFER;
            if (this.pendingResolve) {
              this.pendingResolve();
              this.pendingResolve = null;
            }
          }
          break;
      }
    }
  }

  /**
   * Process RDB data received from master
   */
  processRDB() {
    // If we haven't yet parsed the header, do that first
    if (!this.rdbExpectedLength) {
      if (!this.buffer.startsWith('$')) {
        // Wait for more data
        return;
      }

      const crlfIndex = this.buffer.indexOf('\r\n');
      if (crlfIndex === -1) {
        // Wait for more data
        return;
      }

      const lenStr = this.buffer.slice(1, crlfIndex);
      const parsedLength = parseInt(lenStr, 10);
      if (isNaN(parsedLength) || parsedLength < 0) {
        console.error('Invalid RDB length header from master');
        this.connection.destroy();
        return;
      }

      this.rdbExpectedLength = parsedLength;
      console.log(`Parsed RDB expected length: ${this.rdbExpectedLength}`);
      this.buffer = this.buffer.slice(crlfIndex + 2);
    }

    // Now we know how many bytes of raw payload to expect
    if (this.buffer.length < this.rdbExpectedLength) {
      // Wait for more
      return;
    }

    // Consume exactly RDB payload
    const rdbPayload = this.buffer.slice(0, this.rdbExpectedLength);
    console.log(`Consuming entire RDB payload of ${this.rdbExpectedLength} bytes`);
    this.buffer = this.buffer.slice(this.rdbExpectedLength);

    // Done
    this.rdbProcessed = true;
    this.currentStage = HANDSHAKE_STAGES.COMPLETED;
    console.log('RDB transfer complete. Switching to replication command mode.');
  }

  /**
   * Process replication commands after handshake is complete
   */
  processReplicationBuffer() {
    // First, handle RDB if we're still in RDB transfer stage
    if (this.currentStage === HANDSHAKE_STAGES.RDB_TRANSFER && !this.rdbProcessed) {
      this.processRDB();
      return;
    }

    // Process replication commands
    try {
      while (this.buffer.length > 0) {
        // Skip any leftover binary data or non-command data
        while (this.buffer.length > 0 && !this.buffer.startsWith('*')) {
          this.buffer = this.buffer.slice(1);
        }
        
        if (this.buffer.length === 0) break;
        
        // Find the end of the current command
        const lines = this.buffer.split('\r\n');
        if (!lines[0].startsWith("*")) break;

        const count = parseInt(lines[0].slice(1), 10);
        if (isNaN(count) || count <= 0) break;
        
        const args = [];
        let i = 1;
        let bytesConsumed = lines[0].length + 2; // +2 for \r\n
        // Parse each argument
        while (args.length < count && i < lines.length) {
          if (!lines[i].startsWith("$")) break;
          
          const len = parseInt(lines[i].slice(1), 10);
          if (isNaN(len) || i + 1 >= lines.length) break;
          
          bytesConsumed += lines[i].length + 2; // +2 for \r\n
          if (len >= 0) {
            args.push(lines[i + 1]);
            bytesConsumed += lines[i + 1].length + 2; // +2 for \r\n
          }
          
          i += 2;
        }

        // If we don't have all arguments, wait for more data
        if (args.length !== count) break;

        // Remove consumed bytes from buffer
        this.buffer = this.buffer.slice(bytesConsumed);

        // Handle the command
        console.log(`Received replication command:`, args);
        
        // Check if this is a REPLCONF GETACK command
        if (args.length === 3 && 
            args[0].toUpperCase() === 'REPLCONF' && 
            args[1].toUpperCase() === 'GETACK') {
          
          console.log(`Responding to REPLCONF GETACK with offset 0`);
          const response = serialize.array(['REPLCONF', 'ACK', '0']);
          this.connection.write(response);
        } else {
          // For other commands, just process them without sending a response
          this.commandHandler.handle(args, null);
        }
      }
    } catch (err) {
      console.error("Error processing replication command:", err.message);
    }
  }
}

module.exports = ReplicaHandshake;