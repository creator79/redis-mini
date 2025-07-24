/**
 * In-memory key-value store for Redis
 */

// In-memory database
const db = {};

/**
 * Set a key-value pair in the database
 * @param {string} key - Key to set
 * @param {string} value - Value to set
 * @param {number|null} expiresAt - Timestamp when the key expires (null for no expiry)
 * @param {string} type - Data type (string, stream, etc.)
 */
function set(key, value, expiresAt = null, type = 'string') {
  db[key] = { value, expiresAt, type };
}

/**
 * Get a value from the database
 * @param {string} key - Key to get
 * @returns {Object|null} Value object or null if not found or expired
 */
function get(key) {
  const record = db[key];
  
  if (!record) {
    return null;
  }
  
  // Check if key has expired
  if (record.expiresAt && Date.now() >= record.expiresAt) {
    delete db[key];
    return null;
  }
  
  return record;
}

/**
 * Delete a key from the database
 * @param {string} key - Key to delete
 * @returns {boolean} True if key was deleted, false if it didn't exist
 */
function del(key) {
  if (db[key]) {
    delete db[key];
    return true;
  }
  return false;
}

/**
 * Get all keys matching a pattern
 * @param {string} pattern - Pattern to match (* for all, prefix* for prefix match)
 * @returns {string[]} Array of matching keys
 */
function keys(pattern) {
  if (pattern === '*') {
    return Object.keys(db);
  } else if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return Object.keys(db).filter(k => k.startsWith(prefix));
  } else {
    return Object.keys(db).filter(k => k === pattern);
  }
}

/**
 * Get the type of a key
 * @param {string} key - Key to check
 * @returns {string} Type of the key (string, stream, none)
 */
function type(key) {
  const record = get(key);
  if (!record) {
    return 'none';
  }
  return record.type;
}

/**
 * Increment a numeric string value
 * @param {string} key - Key to increment
 * @returns {number|null} New value or null if not a valid numeric string
 */
function incr(key) {
  const record = get(key);
  
  if (record && record.type === 'string' && /^-?\d+$/.test(record.value)) {
    let num = parseInt(record.value, 10);
    num += 1;
    record.value = num.toString();
    return num;
  }
  
  return null;
}

/**
 * Add an entry to a stream
 * @param {string} key - Stream key
 * @param {string} id - Entry ID
 * @param {Object} fields - Field-value pairs
 * @returns {string} The ID of the added entry
 */
function xadd(key, id, fields) {
  // Create stream if it doesn't exist
  if (!db[key]) {
    db[key] = { type: 'stream', entries: [] };
  }
  
  // Add entry
  const entry = { id, ...fields };
  db[key].entries.push(entry);
  
  return id;
}

/**
 * Get all entries in the database
 * @returns {Object} The database object
 */
function getAll() {
  return db;
}

module.exports = {
  set,
  get,
  del,
  keys,
  type,
  incr,
  xadd,
  getAll
};