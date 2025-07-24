/**
 * RESP (Redis Serialization Protocol) Encoder
 */

class Encoder {
  /**
   * Encode a simple string in RESP format
   * @param {string} str - String to encode
   * @returns {string} RESP encoded string
   */
  static encodeSimpleString(str) {
    return `+${str}\r\n`;
  }

  /**
   * Encode an error in RESP format
   * @param {string} str - Error message
   * @returns {string} RESP encoded error
   */
  static encodeError(str) {
    return `-ERR ${str}\r\n`;
  }

  /**
   * Encode a bulk string in RESP format
   * @param {string} str - String to encode
   * @returns {string} RESP encoded bulk string
   */
  static encodeBulkString(str) {
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
  static encodeInteger(n) {
    return `:${n}\r\n`;
  }

  /**
   * Encode an array of strings in RESP format
   * @param {string[]} arr - Array of strings to encode
   * @returns {string} RESP encoded array
   */
  static encodeArray(arr) {
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
  static encodeArrayDeep(arr) {
    let resp = `*${arr.length}\r\n`;
    for (const item of arr) {
      if (Array.isArray(item)) {
        resp += this.encodeArrayDeep(item);
      } else {
        resp += `$${item.length}\r\n${item}\r\n`;
      }
    }
    return resp;
  }
}

module.exports = Encoder;