// constants.js
// Contains all the constants used throughout the application

const ROLES = {
  MASTER: "master",
  SLAVE: "slave",
};

const HANDSHAKE_STAGES = {
  PING: "PING",
  REPLCONF_LISTENING_PORT: "REPLCONF_LISTENING_PORT",
  REPLCONF_CAPA: "REPLCONF_CAPA",
  PSYNC: "PSYNC",
  RDB_TRANSFER: "RDB_TRANSFER",
  COMPLETED: "COMPLETED"
};

const COMMANDS = {
  PING: "PING",
  ECHO: "ECHO",
  SET: "SET",
  GET: "GET",
  CONFIG: "CONFIG",
  KEYS: "KEYS",
  INFO: "INFO",
  REPLCONF: "REPLCONF",
  PSYNC: "PSYNC",
  WAIT: "WAIT",
};

const DEFAULT_CONFIG = {
  dir: ".",
  dbfilename: "dump.rdb",
  port: 6379,
  role: ROLES.MASTER,
  masterHost: null,
  masterPort: null,
  masterReplid: "8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb",
  masterReplOffset: 0,
};

module.exports = {
  ROLES,
  HANDSHAKE_STAGES,
  COMMANDS,
  DEFAULT_CONFIG
};