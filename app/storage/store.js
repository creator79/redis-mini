// store.js
// Handles the in-memory key-value store

/**
 * In-memory key-value store with expiration support
 */
class Store {
  constructor() {
    this.data = new Map(); // key -> { value, expiresAt }
  }

  /**
   * Set a key-value pair with optional expiration
   * @param {string} key - The key to set
   * @param {string} value - The value to store
   * @param {number|null} expiresAt - Optional timestamp when the key expires
   */
  set(key, value, expiresAt = null) {
    this.data.set(key, { value, expiresAt });
  }

  /**
   * Get a value by key, handling expiration
   * @param {string} key - The key to retrieve
   * @returns {string|null} - The value or null if not found or expired
   */
  get(key) {
    const record = this.data.get(key);
    if (!record) return null;

    if (record.expiresAt && Date.now() > record.expiresAt) {
      this.data.delete(key);
      return null;
    }

    return record;
  }

  /**
   * Delete a key from the store
   * @param {string} key - The key to delete
   * @returns {boolean} - True if the key was deleted, false if it didn't exist
   */
  delete(key) {
    return this.data.delete(key);
  }

  /**
   * Check if a key exists in the store
   * @param {string} key - The key to check
   * @returns {boolean} - True if the key exists and is not expired
   */
  exists(key) {
    const record = this.get(key);
    return record !== null;
  }

  /**
   * Get all keys in the store, filtering out expired ones
   * @returns {Array<string>} - Array of valid keys
   */
  keys() {
    const validKeys = [];
    for (const [key, record] of this.data.entries()) {
      if (!record.expiresAt || Date.now() <= record.expiresAt) {
        validKeys.push(key);
      } else {
        this.data.delete(key);
      }
    }
    return validKeys;
  }

  /**
   * Get all entries in the store
   * @returns {Map} - The underlying Map object
   */
  entries() {
    return this.data.entries();
  }
}

// Create a singleton instance
const store = new Store();

module.exports = store;