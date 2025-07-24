// replica-manager.js
// Handles replica management for master instances

/**
 * Manages replica connections and propagation of commands
 */
class ReplicaManager {
  constructor() {
    this.replicas = new Map(); // connection -> { offset, lastAck, connection }
    this.masterOffset = 0;
    this.waitingCommands = new Map(); // commandId -> { requiredReplicas, timeout, resolve, reject }
  }

  /**
   * Add a new replica connection
   * @param {net.Socket} connection - The replica connection
   */
  addReplica(connection) {
    const replica = {
      offset: 0,
      lastAck: Date.now(),
      connection: connection,
    };
    this.replicas.set(connection, replica);
    console.log(`Added replica. Total replicas: ${this.replicas.size}`);
  }

  /**
   * Remove a replica connection
   * @param {net.Socket} connection - The replica connection to remove
   */
  removeReplica(connection) {
    this.replicas.delete(connection);
    console.log(`Removed replica. Total replicas: ${this.replicas.size}`);
  }

  /**
   * Propagate a command to all replicas
   * @param {string} command - The serialized command
   * @param {number} commandBytes - The size of the command in bytes
   */
  propagateCommand(command, commandBytes) {
    if (this.replicas.size === 0) return;

    console.log(
      `Propagating command to ${this.replicas.size} replicas:`,
      command
    );

    // Update master offset
    this.masterOffset += commandBytes;

    // Send command to all replicas
    for (const [connection, replica] of this.replicas) {
      try {
        connection.write(command);
        console.log(`Sent command to replica`);
      } catch (error) {
        console.error(`Error sending to replica:`, error.message);
        this.removeReplica(connection);
      }
    }
  }

  /**
   * Update a replica's offset
   * @param {net.Socket} connection - The replica connection
   * @param {number} offset - The new offset
   */
  updateReplicaOffset(connection, offset) {
    const replica = this.replicas.get(connection);
    if (replica) {
      replica.offset = offset;
      replica.lastAck = Date.now();
      console.log(`Updated replica offset to ${offset}`);

      // Check if any WAIT commands can be resolved
      this.checkWaitingCommands();
    }
  }

  /**
   * Get the number of replicas
   * @returns {number} - The number of replicas
   */
  getReplicaCount() {
    return this.replicas.size;
  }

  /**
   * Get the number of replicas at or beyond a specific offset
   * @param {number} targetOffset - The target offset
   * @returns {number} - The number of replicas at or beyond the offset
   */
  getReplicasAtOffset(targetOffset) {
    let count = 0;
    for (const [connection, replica] of this.replicas) {
      if (replica.offset >= targetOffset) {
        count++;
      }
    }
    return count;
  }

  /**
   * Wait for a specific number of replicas to acknowledge a command
   * @param {number} numReplicas - The number of replicas to wait for
   * @param {number} timeout - The timeout in milliseconds
   * @returns {Promise<number>} - A promise that resolves to the number of replicas that acknowledged
   */
  waitForReplicas(numReplicas, timeout) {
    return new Promise((resolve, reject) => {
      const currentOffset = this.masterOffset;
      const replicasAtOffset = this.getReplicasAtOffset(currentOffset);

      console.log(
        `WAIT: Need ${numReplicas} replicas at offset ${currentOffset}, currently have ${replicasAtOffset}`
      );

      // If we already have enough replicas at the current offset, resolve immediately
      if (replicasAtOffset >= numReplicas) {
        console.log(`WAIT: Already have enough replicas`);
        resolve(replicasAtOffset);
        return;
      }

      // If we have no replicas, resolve with 0
      if (this.replicas.size === 0) {
        console.log(`WAIT: No replicas connected`);
        resolve(0);
        return;
      }

      // Send REPLCONF GETACK to all replicas to get their current offset
      const { serialize } = require('../protocol/resp');
      const { COMMANDS } = require('../config/constants');
      const getackCommand = serialize.array([COMMANDS.REPLCONF, "GETACK", "*"]);
      
      for (const [connection, replica] of this.replicas) {
        try {
          connection.write(getackCommand);
          console.log(`Sent GETACK to replica`);
        } catch (error) {
          console.error(`Error sending GETACK to replica:`, error.message);
          this.removeReplica(connection);
        }
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        const finalCount = this.getReplicasAtOffset(currentOffset);
        console.log(`WAIT: Timeout reached, returning ${finalCount} replicas`);
        resolve(finalCount);
      }, timeout);

      // Store the wait command
      const commandId = Date.now() + Math.random();
      this.waitingCommands.set(commandId, {
        requiredReplicas: numReplicas,
        targetOffset: currentOffset,
        timeout: timeoutId,
        resolve: (count) => {
          clearTimeout(timeoutId);
          this.waitingCommands.delete(commandId);
          resolve(count);
        },
      });
    });
  }

  /**
   * Check if any waiting commands can be resolved
   */
  checkWaitingCommands() {
    for (const [commandId, waitCmd] of this.waitingCommands) {
      const replicasAtOffset = this.getReplicasAtOffset(waitCmd.targetOffset);
      console.log(
        `Checking WAIT command: need ${waitCmd.requiredReplicas}, have ${replicasAtOffset} at offset ${waitCmd.targetOffset}`
      );

      if (replicasAtOffset >= waitCmd.requiredReplicas) {
        console.log(`WAIT command satisfied with ${replicasAtOffset} replicas`);
        waitCmd.resolve(replicasAtOffset);
      }
    }
  }

  /**
   * Get the current master offset
   * @returns {number} - The master offset
   */
  getMasterOffset() {
    return this.masterOffset;
  }
}

module.exports = ReplicaManager;