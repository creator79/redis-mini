/**
 * Constants used throughout the Redis server implementation
 */

const ROLES = {
  MASTER: 'master',
  SLAVE: 'slave'
};

const HANDSHAKE_STAGES = {
  INITIAL: 0,
  REPLCONF_LISTENING_PORT: 1,
  REPLCONF_CAPA: 2,
  PSYNC: 3
};

const DEFAULT_PORT = 6379;

const EMPTY_RDB = Buffer.from([
  0x52, 0x45, 0x44, 0x49, 0x53, 0x30, 0x30, 0x31, 0x31, 0xff, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00,
]);

const MASTER_REPL_ID = "8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb";

module.exports = {
  ROLES,
  HANDSHAKE_STAGES,
  DEFAULT_PORT,
  EMPTY_RDB,
  MASTER_REPL_ID
};