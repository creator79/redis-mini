
const HEADER = '5245444953'; // "REDIS"
const HASH_TABLE_START = 'fb';
const EOF = 'ff';

/**
 * Convert hex string to ASCII.
 * Example: "68656c6c6f" → "hello"
 */
function hexToASCII(hex) {
  let ascii = '';
  for (let i = 0; i < hex.length; i += 2) {
    ascii += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  }
  return ascii;
}

/**
 * Parse the RDB file's hex string and return key-value pairs.
 * Supports one or more key-value pairs.
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

  let stringData = hexString.slice(fbIndex + 2 + 4).split(EOF)[0];
  const result = [];

  while (stringData.length >= 4) {
    const keyLen = parseInt(stringData.slice(2, 4), 16);
    const keyHex = stringData.slice(4, 4 + keyLen * 2);
    const key = hexToASCII(keyHex);

    stringData = stringData.slice(4 + keyLen * 2);
    if (stringData.length < 4) break;

    const valLen = parseInt(stringData.slice(2, 4), 16);
    const valHex = stringData.slice(4, 4 + valLen * 2);
    const value = hexToASCII(valHex);

    result.push({ key, value });

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
