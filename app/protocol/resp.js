/**
 * Redis Serialization Protocol (RESP) implementation
 */

/**
 * Parses RESP data from a buffer
 * @param {Buffer} buffer - Buffer containing RESP data
 * @returns {Array|null} Parsed command array or null if invalid
 */
function parseRESP(buffer) {
  const str = buffer.toString();

  if (str[0] !== '*') {
    return null;
  }

  const parts = str.split('\r\n').filter(Boolean);

  let arr = [];
  for (let i = 2; i < parts.length; i += 2) {
    arr.push(parts[i]);
  }

  return arr;
}

/**
 * Minimal RESP parser for a single array from Buffer, returns [arr, bytesRead]
 * Used by replica mode to parse incoming commands
 * @param {Buffer} buf - Buffer containing RESP data
 * @returns {[Array|null, number]} Parsed array and bytes read, or [null, 0] if invalid
 */
function tryParseRESP(buf) {
  if (buf[0] !== 42) return [null, 0]; // not '*'
  const str = buf.toString();
  const firstLineEnd = str.indexOf('\r\n');
  if (firstLineEnd === -1) return [null, 0];
  const numElems = parseInt(str.slice(1, firstLineEnd), 10);
  let elems = [];
  let cursor = firstLineEnd + 2;
  for (let i = 0; i < numElems; i++) {
    if (buf[cursor] !== 36) return [null, 0]; // not '$'
    const lenLineEnd = buf.indexOf('\r\n', cursor);
    if (lenLineEnd === -1) return [null, 0];
    const len = parseInt(buf.slice(cursor + 1, lenLineEnd).toString(), 10);
    const valStart = lenLineEnd + 2;
    const valEnd = valStart + len;
    if (valEnd + 2 > buf.length) return [null, 0]; // incomplete value
    const val = buf.slice(valStart, valEnd).toString();
    elems.push(val);
    cursor = valEnd + 2;
  }
  return [elems, cursor];
}

/**
 * Encode a simple string in RESP format
 * @param {string} str - String to encode
 * @returns {string} RESP encoded string
 */
function encodeSimpleString(str) {
  return `+${str}\r\n`;
}

/**
 * Encode an error in RESP format
 * @param {string} str - Error message
 * @returns {string} RESP encoded error
 */
function encodeError(str) {
  return `-ERR ${str}\r\n`;
}

/**
 * Encode a bulk string in RESP format
 * @param {string} str - String to encode
 * @returns {string} RESP encoded bulk string
 */
function encodeBulkString(str) {
  if (str === null) {
    return '$-1\r\n';
  }
  return `$${str.length}\r\n${str}\r\n`;
}

/**
 * Encode an integer in RESP format
 * @param {number} n - Integer to encode
 * @returns {string} RESP encoded integer
 */
function encodeInteger(n) {
  return `:${n}\r\n`;
}

/**
 * Encode an array of strings in RESP format
 * @param {string[]} arr - Array of strings to encode
 * @returns {string} RESP encoded array
 */
function encodeArray(arr) {
  let resp = `*${arr.length}\r\n`;
  for (const val of arr) {
    resp += `$${val.length}\r\n${val}\r\n`;
  }
  return resp;
}

/**
 * Encode a nested array in RESP format (for complex data structures)
 * @param {Array} arr - Nested array to encode
 * @returns {string} RESP encoded nested array
 */
function encodeArrayDeep(arr) {
  let resp = `*${arr.length}\r\n`;
  for (const item of arr) {
    if (Array.isArray(item)) {
      resp += encodeArrayDeep(item);
    } else {
      resp += `$${item.length}\r\n${item}\r\n`;
    }
  }
  return resp;
}

module.exports = {
  parseRESP,
  tryParseRESP,
  encodeSimpleString,
  encodeError,
  encodeBulkString,
  encodeInteger,
  encodeArray,
  encodeArrayDeep
};