// utils.js
const HEADER = '5245444953';  // "REDIS"
const HASH_TABLE_START = 'fb';
const EOF = 'ff';
const MILLISECONDS_EXPIRY = 'fc';
const SECONDS_EXPIRY = 'fd';

/**
 * Convert hex string to ASCII.
 */
function hexToASCII(hex) {
  let ascii = '';
  for (let i = 0; i < hex.length; i += 2) {
    ascii += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return ascii;
}

/**
 * Parse an unsigned big-endian hex string to integer.
 */
function hexToInt(hex) {
  return parseInt(hex, 16);
}

/**
 * Parse the RDB hex data to extract key-value pairs with optional expiry.
 * Returns array of { key, value, expiresAt }
 */
function parseHexRDB(hexString) {
  if (!hexString.startsWith(HEADER)) {
    throw new Error("Invalid RDB header");
  }

  const fbIndex = hexString.indexOf(HASH_TABLE_START);
  if (fbIndex === -1) {
    console.log("No FB marker found. Empty DB.");
    return [];
  }

  let remainder = hexString.slice(fbIndex + 2 + 4).split(EOF)[0];

  const result = [];
  let expiresAt = null;

  while (remainder.length >= 2) {
    const marker = remainder.slice(0, 2).toLowerCase();

    if (marker === MILLISECONDS_EXPIRY) {
      // 8-byte expiry (ms since epoch)
      const expiryHex = remainder.slice(2, 18);
      expiresAt = parseInt(expiryHex, 16);
      remainder = remainder.slice(18);
    } else if (marker === SECONDS_EXPIRY) {
      // 4-byte expiry (s since epoch)
      const expiryHex = remainder.slice(2, 10);
      const seconds = parseInt(expiryHex, 16);
      expiresAt = seconds * 1000;
      remainder = remainder.slice(10);
    } else if (marker === '00') {
      remainder = remainder.slice(2);

      // --- KEY ---
      if (remainder.length < 4) break;
      const keyLen = hexToInt(remainder.slice(2, 4));
      const keyHex = remainder.slice(4, 4 + keyLen * 2);
      const key = hexToASCII(keyHex);
      remainder = remainder.slice(4 + keyLen * 2);

      // --- VALUE ---
      if (remainder.length < 4) break;
      const valLen = hexToInt(remainder.slice(2, 4));
      const valHex = remainder.slice(4, 4 + valLen * 2);
      const value = hexToASCII(valHex);
      remainder = remainder.slice(4 + valLen * 2);

      result.push({ key, value, expiresAt });
      expiresAt = null;
    } else {
      // Unknown marker (likely metadata or unhandled type), just stop
      console.warn(`Unknown marker: ${marker}`);
      break;
    }
  }

  return result;
}

module.exports = {
  HEADER,
  HASH_TABLE_START,
  EOF,
  MILLISECONDS_EXPIRY,
  SECONDS_EXPIRY,
  hexToASCII,
  parseHexRDB
};
