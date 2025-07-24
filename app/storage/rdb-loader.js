// rdb-loader.js
// Handles loading data from RDB files

const fs = require('fs');
const path = require('path');
const { parseHexRDB } = require('../utils');
const store = require('./store');

/**
 * Load data from an RDB file into the in-memory store
 * @param {Object} config - Server configuration containing dir and dbfilename
 */
function loadData(config) {
  const fullPath = path.join(config.dir, config.dbfilename);

  if (!fs.existsSync(fullPath)) {
    console.log("No RDB file found. Starting empty.");
    return;
  }

  console.log(`Loading from ${fullPath}`);

  try {
    const buffer = fs.readFileSync(fullPath);
    const hexString = buffer.toString("hex");
    const pairs = parseHexRDB(hexString);

    pairs.forEach(({ key, value, expiresAt }) => {
      if (expiresAt && Date.now() > expiresAt) {
        console.log(
          `Skipping expired key: ${key} (expired at ${new Date(
            expiresAt
          ).toISOString()})`
        );
        return;
      }

      store.set(key, value, expiresAt);
      const expiryInfo = expiresAt
        ? ` (expires at ${new Date(expiresAt).toISOString()})`
        : "";
      console.log(`Loaded key: ${key} -> ${value}${expiryInfo}`);
    });

    console.log(`Successfully loaded ${pairs.length} key-value pairs`);
  } catch (err) {
    console.error("Error loading RDB file:", err.message);
    console.error("Stack trace:", err.stack);
  }
}

module.exports = {
  loadData
};