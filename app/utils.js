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
 * Parse little-endian hex string to integer.
 */
function hexToIntLE(hex) {
  let result = 0;
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    result = (result << 8) + parseInt(hex.substring(i, i + 2), 16);
  }
  return result;
}

/**
 * Parse big-endian hex string to integer.
 */
function hexToInt(hex) {
  return parseInt(hex, 16);
}

/**
 * Parse length encoding from RDB format
 */
function parseLength(hex, offset) {
  if (offset >= hex.length) {
    throw new Error("Unexpected end of data while parsing length");
  }
  
  const firstByte = parseInt(hex.substring(offset, offset + 2), 16);
  
  if ((firstByte & 0xC0) === 0x00) {
    // 6-bit length
    return { length: firstByte & 0x3F, bytesRead: 1 };
  } else if ((firstByte & 0xC0) === 0x40) {
    // 14-bit length
    if (offset + 2 >= hex.length) {
      throw new Error("Unexpected end of data while parsing 14-bit length");
    }
    const secondByte = parseInt(hex.substring(offset + 2, offset + 4), 16);
    return { length: ((firstByte & 0x3F) << 8) | secondByte, bytesRead: 2 };
  } else if ((firstByte & 0xC0) === 0x80) {
    // 32-bit length
    if (offset + 8 >= hex.length) {
      throw new Error("Unexpected end of data while parsing 32-bit length");
    }
    const lengthHex = hex.substring(offset + 2, offset + 10);
    return { length: hexToInt(lengthHex), bytesRead: 5 };
  } else {
    // Special encoding
    throw new Error(`Special encoding not supported: ${firstByte.toString(16)}`);
  }
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

  // Skip past FB marker and hash table size info
  let offset = fbIndex + 2;
  
  // Skip hash table size (usually 2 bytes each for hash table size and expiry size)
  offset += 4;

  const result = [];
  let expiresAt = null;

  while (offset < hexString.length) {
    const marker = hexString.slice(offset, offset + 2).toLowerCase();

    if (marker === EOF) {
      break;
    } else if (marker === MILLISECONDS_EXPIRY) {
      // 8-byte expiry (ms since epoch) - little endian
      if (offset + 18 > hexString.length) {
        throw new Error("Unexpected end of data while parsing milliseconds expiry");
      }
      const expiryHex = hexString.slice(offset + 2, offset + 18);
      expiresAt = hexToIntLE(expiryHex);
      
      // Validate timestamp (should be reasonable)
      if (expiresAt < 0 || expiresAt > Date.now() + 100 * 365 * 24 * 60 * 60 * 1000) {
        console.warn(`Invalid expiry timestamp: ${expiresAt}, ignoring expiry`);
        expiresAt = null;
      }
      
      offset += 18;
    } else if (marker === SECONDS_EXPIRY) {
      // 4-byte expiry (s since epoch) - little endian
      if (offset + 10 > hexString.length) {
        throw new Error("Unexpected end of data while parsing seconds expiry");
      }
      const expiryHex = hexString.slice(offset + 2, offset + 10);
      const seconds = hexToIntLE(expiryHex);
      expiresAt = seconds * 1000;
      
      // Validate timestamp
      if (seconds < 0 || seconds > Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 60 * 60) {
        console.warn(`Invalid expiry timestamp: ${seconds}, ignoring expiry`);
        expiresAt = null;
      }
      
      offset += 10;
    } else if (marker === '00') {
      // String value type
      offset += 2;

      try {
        // Parse key length and key
        const keyLengthInfo = parseLength(hexString, offset);
        offset += keyLengthInfo.bytesRead * 2;
        
        if (offset + keyLengthInfo.length * 2 > hexString.length) {
          throw new Error("Unexpected end of data while parsing key");
        }
        
        const keyHex = hexString.slice(offset, offset + keyLengthInfo.length * 2);
        const key = hexToASCII(keyHex);
        offset += keyLengthInfo.length * 2;

        // Parse value length and value
        const valueLengthInfo = parseLength(hexString, offset);
        offset += valueLengthInfo.bytesRead * 2;
        
        if (offset + valueLengthInfo.length * 2 > hexString.length) {
          throw new Error("Unexpected end of data while parsing value");
        }
        
        const valueHex = hexString.slice(offset, offset + valueLengthInfo.length * 2);
        const value = hexToASCII(valueHex);
        offset += valueLengthInfo.length * 2;

        result.push({ key, value, expiresAt });
        expiresAt = null; // Reset expiry for next key
      } catch (err) {
        console.error(`Error parsing key-value pair: ${err.message}`);
        break;
      }
    } else {
      // Unknown marker, try to skip
      console.warn(`Unknown marker: ${marker} at offset ${offset}`);
      offset += 2;
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
  hexToIntLE,
  parseLength,
  parseHexRDB
};