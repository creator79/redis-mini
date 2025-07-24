// command-handler.js
// Handles Redis commands and their execution

const { COMMANDS, ROLES } = require('../config/constants');
const { serialize } = require('../protocol/resp');
const store = require('../storage/store');

/**
 * Handles Redis commands
 */
class CommandHandler {
  /**
   * Create a new CommandHandler instance
   * @param {Object} config - Server configuration
   * @param {ReplicaManager} replicaManager - Replica manager instance
   */
  constructor(config, replicaManager) {
    this.config = config;
    this.replicaManager = replicaManager;
  }

  /**
   * Handle a Redis command
   * @param {Array<string>} args - Command arguments
   * @param {net.Socket|null} connection - Client connection
   * @returns {string|null} - Response to send to the client
   */
  async handle(args, connection = null) {
    if (args.length === 0) return serialize.error("ERR empty command");

    const cmd = args[0].toUpperCase();

    switch (cmd) {
      case COMMANDS.PING:
        return this.handlePing(args);
      case COMMANDS.ECHO:
        return this.handleEcho(args);
      case COMMANDS.SET:
        return this.handleSet(args, connection);
      case COMMANDS.GET:
        return this.handleGet(args);
      case COMMANDS.CONFIG:
        return this.handleConfig(args);
      case COMMANDS.KEYS:
        return this.handleKeys(args);
      case COMMANDS.INFO:
        return this.handleInfo(args);
      case COMMANDS.REPLCONF:
        return this.handleReplconf(args, connection);
      case COMMANDS.PSYNC:
        return this.handlePsync(args, connection);
      case COMMANDS.WAIT:
        return this.handleWait(args);
      default:
        return serialize.error(`ERR unknown command '${cmd}'`);
    }
  }

  /**
   * Handle the PING command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  handlePing(args) {
    return serialize.simple("PONG");
  }

  /**
   * Handle the ECHO command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  handleEcho(args) {
    if (args.length < 2) {
      return serialize.error("ERR wrong number of arguments for ECHO");
    }
    return serialize.bulk(args[1]);
  }

  /**
   * Handle the SET command
   * @param {Array<string>} args - Command arguments
   * @param {net.Socket|null} connection - Client connection
   * @returns {string} - Response
   */
  handleSet(args, connection) {
    if (args.length < 3) {
      return serialize.error("ERR wrong number of arguments for SET");
    }

    const key = args[1];
    const value = args[2];
    let expiresAt = null;

    for (let i = 3; i < args.length - 1; i++) {
      if (args[i].toUpperCase() === "PX") {
        const px = parseInt(args[i + 1], 10);
        if (isNaN(px) || px < 0) {
          return serialize.error("ERR invalid PX value");
        }
        expiresAt = Date.now() + px;
      }
    }

    store.set(key, value, expiresAt);

    // Propagate to replicas if this is a master
    if (this.config.role === ROLES.MASTER) {
      const command = serialize.array(args);
      const commandBytes = Buffer.byteLength(command);
      this.replicaManager.propagateCommand(command, commandBytes);
    }

    return serialize.simple("OK");
  }

  /**
   * Handle the GET command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  handleGet(args) {
    if (args.length < 2) {
      return serialize.error("ERR wrong number of arguments for GET");
    }

    const record = store.get(args[1]);
    if (!record) return serialize.bulk(null);

    return serialize.bulk(record.value);
  }

  /**
   * Handle the CONFIG command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  handleConfig(args) {
    if (args.length === 3 && args[1].toUpperCase() === "GET") {
      const param = args[2];
      let value = "";

      if (param === "dir") {
        value = this.config.dir;
      } else if (param === "dbfilename") {
        value = this.config.dbfilename;
      }

      return serialize.array([param, value]);
    }
    return serialize.error("ERR wrong CONFIG usage");
  }

  /**
   * Handle the KEYS command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  handleKeys(args) {
    if (args.length === 2 && args[1] === "*") {
      const validKeys = store.keys();
      return serialize.array(validKeys);
    }
    return serialize.error("ERR only KEYS * supported");
  }

  /**
   * Handle the INFO command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  handleInfo(args) {
    if (args.length === 2 && args[1].toLowerCase() === "replication") {
      const infoLines = [`role:${this.config.role}`];

      if (this.config.role === ROLES.MASTER) {
        infoLines.push(`master_replid:${this.config.masterReplid}`);
        infoLines.push(
          `master_repl_offset:${this.replicaManager.getMasterOffset()}`
        );
      }

      return serialize.bulk(infoLines.join("\r\n"));
    }
    return serialize.error("ERR only INFO replication supported for now");
  }

  /**
   * Handle the REPLCONF command
   * @param {Array<string>} args - Command arguments
   * @param {net.Socket|null} connection - Client connection
   * @returns {string|null} - Response
   */
  handleReplconf(args, connection) {
    if (args.length < 2) {
      return serialize.error("ERR wrong number of arguments for REPLCONF");
    }

    const subcommand = args[1].toUpperCase();

    switch (subcommand) {
      case "LISTENING-PORT":
        // During handshake - just acknowledge
        return serialize.simple("OK");

      case "CAPA":
        // During handshake - just acknowledge
        return serialize.simple("OK");

      case "ACK":
        // Replica is acknowledging receipt of commands
        if (args.length >= 3) {
          const offset = parseInt(args[2], 10);
          if (!isNaN(offset) && connection) {
            console.log(`Received ACK from replica with offset ${offset}`);
            this.replicaManager.updateReplicaOffset(connection, offset);
          }
        }
        // Don't send a response for ACK
        return null;

      case "GETACK":
        // Master is asking for current offset - this should be handled by replica
        // For now, just return current offset (slaves don't track offset in this implementation)
        return serialize.array([COMMANDS.REPLCONF, "ACK", "0"]);

      default:
        return serialize.simple("OK");
    }
  }

  /**
   * Handle the PSYNC command
   * @param {Array<string>} args - Command arguments
   * @param {net.Socket|null} connection - Client connection
   * @returns {string} - Response
   */
  handlePsync(args, connection) {
    if (this.config.role !== ROLES.MASTER) {
      return serialize.error("ERR PSYNC can only be sent to master");
    }

    // Add this connection as a replica
    if (connection) {
      this.replicaManager.addReplica(connection);
    }

    // Send FULLRESYNC response
    const response = serialize.simple(
      `FULLRESYNC ${
        this.config.masterReplid
      } ${this.replicaManager.getMasterOffset()}`
    );

    // Send empty RDB file after FULLRESYNC
    if (connection) {
      setImmediate(() => {
        // Send empty RDB file (just the header)
        const emptyRdb = Buffer.from(
          "524544495330303131fa0972656469732d76657205372e322e30fa0a72656469732d62697473c040fa056374696d65c26d08bc65fa08757365642d6d656dc2b0c41000fa08616f662d62617365c000fff06e3bfec0ff5aa2",
          "hex"
        );
        connection.write(`$${emptyRdb.length}\r\n`);
        connection.write(emptyRdb);
      });
    }

    return response;
  }

  /**
   * Handle the WAIT command
   * @param {Array<string>} args - Command arguments
   * @returns {string} - Response
   */
  async handleWait(args) {
    if (args.length < 3) {
      return serialize.error("ERR wrong number of arguments for WAIT");
    }

    const numReplicas = parseInt(args[1], 10);
    const timeout = parseInt(args[2], 10);

    if (isNaN(numReplicas) || isNaN(timeout)) {
      return serialize.error("ERR invalid arguments for WAIT");
    }

    if (this.config.role !== ROLES.MASTER) {
      return serialize.error("ERR WAIT can only be sent to master");
    }

    console.log(
      `WAIT command: waiting for ${numReplicas} replicas with timeout ${timeout}ms`
    );

    try {
      const count = await this.replicaManager.waitForReplicas(
        numReplicas,
        timeout
      );
      return serialize.integer(count);
    } catch (error) {
      console.error("Error in WAIT command:", error.message);
      return serialize.error("ERR WAIT command failed");
    }
  }
}

module.exports = CommandHandler;