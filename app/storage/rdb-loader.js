/**
 * RDB file loading and parsing
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');

/**
 * Read size-encoded integer from RDB buffer
 * @param {Buffer} buffer - RDB buffer
 * @param {number} offset - Current offset in buffer
 * @returns {[number, number]} Value and length of the encoded integer
 */
function readRDBLength(buffer, offset) {
  let first = buffer[offset];
  let type = first >> 6;
  if (type === 0) {
    return [first & 0x3f, 1];
  } else if (type === 1) {
    let val = ((first & 0x3f) << 8) | buffer[offset + 1];
    return [val, 2];
  } else if (type === 2) {
    let val =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];
    return [val, 5];
  } else if (type === 3) {
    return [0, 1];
  }
}

/**
 * Read string-encoded value from RDB buffer
 * @param {Buffer} buffer - RDB buffer
 * @param {number} offset - Current offset in buffer
 * @returns {[string, number]} String value and total length read
 */
function readRDBString(buffer, offset) {
  let [strlen, lenlen] = readRDBLength(buffer, offset);
  offset += lenlen;
  let str = buffer.slice(offset, offset + strlen).toString();
  return [str, lenlen + strlen];
}

/**
 * Load data from RDB file into the store
 * @param {string} filepath - Path to RDB file
 */
function loadRDB(filepath) {
  // Don't try to load if filepath is missing, doesn't exist, or is a directory
  if (
    !filepath ||
    !fs.existsSync(filepath) ||
    !fs.statSync(filepath).isFile()
  ) {
    return;
  }
  
  const buffer = fs.readFileSync(filepath);
  let offset = 0;

  // Header: REDIS0011 (9 bytes)
  offset += 9;

  // Skip metadata sections (starts with 0xFA)
  while (buffer[offset] === 0xfa) {
    offset++; // skip FA
    // name
    let [name, nameLen] = readRDBString(buffer, offset);
    offset += nameLen;
    // value
    let [val, valLen] = readRDBString(buffer, offset);
    offset += valLen;
  }

  // Scan until 0xFE (start of database section)
  while (offset < buffer.length && buffer[offset] !== 0xfe) {
    offset++;
  }

  // DB section starts with 0xFE
  if (buffer[offset] === 0xfe) {
    offset++;
    // db index (size encoded)
    let [dbIndex, dbLen] = readRDBLength(buffer, offset);
    offset += dbLen;
    // Hash table size info: starts with FB
    if (buffer[offset] === 0xfb) {
      offset++;
      // key-value hash table size
      let [kvSize, kvSizeLen] = readRDBLength(buffer, offset);
      offset += kvSizeLen;
      // expiry hash table size (skip)
      let [expSize, expLen] = readRDBLength(buffer, offset);
      offset += expLen;

      // Only handle string type and expiry
      for (let i = 0; i < kvSize; ++i) {
        let expiresAt = null;

        // Handle optional expiry before type
        if (buffer[offset] === 0xfc) {
          // expiry in ms
          offset++;
          expiresAt = Number(buffer.readBigUInt64LE(offset));
          offset += 8;
        } else if (buffer[offset] === 0xfd) {
          // expiry in s
          offset++;
          expiresAt = buffer.readUInt32LE(offset) * 1000;
          offset += 4;
        }

        let type = buffer[offset++];
        if (type !== 0) continue; // 0 means string type

        let [key, keyLen] = readRDBString(buffer, offset);
        offset += keyLen;
        let [val, valLen] = readRDBString(buffer, offset);
        offset += valLen;
        
        store.set(key, val, expiresAt, 'string');
      }
    }
  }
}

/**
 * Initialize RDB loading based on configuration
 * @param {Object} config - Server configuration
 * @returns {string} Path to the RDB file or empty string if not loaded
 */
function initRDBLoader(config) {
  let rdbPath = '';
  if (config.dir && config.dbfilename) {
    rdbPath = path.join(config.dir, config.dbfilename);
    loadRDB(rdbPath);
  }
  return rdbPath;
}

module.exports = {
  loadRDB,
  initRDBLoader
};