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

  const fbIndex = hexString.indexOf(HASH_TABLE_START);
  if (fbIndex === -1) {
    console.log("No FB marker found. Empty DB.");
    return [];
  }

  // Go to after 'fb' and its payload header (4 bytes for RESIZEDB lengths)
  let stringData = hexString.slice(fbIndex + 2 + 4);

  const result = [];

  while (stringData.length >= 2) {
    // First byte is opcode 00
    const opcode = stringData.slice(0, 2);
    if (opcode === EOF || opcode === '') break;
    if (opcode !== '00') {
      console.error(`Unknown opcode in entry: ${opcode}`);
      break;
    }

    stringData = stringData.slice(2);  // Move past opcode

    // Read key length
    const keyLen = parseInt(stringData.slice(0, 2), 16);
    const keyHex = stringData.slice(2, 2 + keyLen * 2);
    const key = hexToASCII(keyHex);
    stringData = stringData.slice(2 + keyLen * 2);

    if (stringData.length < 2) break;

    // Read value length
    const valueLen = parseInt(stringData.slice(0, 2), 16);
    const valueHex = stringData.slice(2, 2 + valueLen * 2);
    const value = hexToASCII(valueHex);
    stringData = stringData.slice(2 + valueLen * 2);

    result.push({ key, value });
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
