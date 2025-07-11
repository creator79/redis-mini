// utils.js

const HEADER = '5245444953'; // "REDIS"
const HASH_TABLE_START = 'fb';
const EOF = 'ff';

/**
 * Convert a hex string to an ASCII string.
 * Example: "68656c6c6f" -> "hello"
 */
function hexToASCII(hex) {
  let ascii = '';
  for (let i = 0; i < hex.length; i += 2) {
    ascii += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return ascii;
}

/**
 * Parse a Redis RDB file *as hex* and extract key-value pairs.
 * Supports only simplified single-hash-table format.
 * Returns: array of { key, value }
 */
function parseHexRDB(hexString) {
  if (!hexString.startsWith(HEADER)) {
    throw new Error("Invalid RDB header");
  }

  // Locate FB marker (start of hash table)
  const fbIndex = hexString.indexOf(HASH_TABLE_START);
  if (fbIndex === -1) {
    console.log("No FB marker found. Empty DB.");
    return [];
  }

  // Skip FB marker and 4 bytes of header/size metadata after it
  let stringData = hexString.slice(fbIndex + 2 + 4);

  // Trim at FF marker (EOF)
  const eofIndex = stringData.indexOf(EOF);
  if (eofIndex !== -1) {
    stringData = stringData.slice(0, eofIndex);
  }

  const result = [];

  while (stringData.length >= 4) {
    // Key length
    const keyLen = parseInt(stringData.slice(2, 4), 16);
    if (isNaN(keyLen) || keyLen <= 0) break;

    // Key
    const keyHex = stringData.slice(4, 4 + keyLen * 2);
    const key = hexToASCII(keyHex);

    stringData = stringData.slice(4 + keyLen * 2);
    if (stringData.length < 4) break;

    // Value length
    const valLen = parseInt(stringData.slice(2, 4), 16);
    if (isNaN(valLen) || valLen < 0) break;

    // Value
    const valHex = stringData.slice(4, 4 + valLen * 2);
    const value = hexToASCII(valHex);

    result.push({ key, value });

    // Slice off what we read
    stringData = stringData.slice(4 + valLen * 2);
  }

  return result;
}

module.exports = {
  HEADER,
  HASH_TABLE_START,
  EOF,
  hexToASCII,
  parseHexRDB,
};
