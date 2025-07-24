// protocol.js - Simple Redis Serialization Protocol (RESP) implementation

/**
 * Serialize data to RESP format
 */
const serializeRESP = {
  // Simple string: +OK\r\n
  simple: (str) => `+${str}\r\n`,
  
  // Error: -Error message\r\n
  error: (str) => `-${str}\r\n`,
  
  // Integer: :1000\r\n
  integer: (num) => `:${num}\r\n`,
  
  // Bulk string: $6\r\nhello!\r\n
  bulk: (str) => {
    if (str === null) return '$-1\r\n';
    return `$${str.length}\r\n${str}\r\n`;
  },
  
  // Array: *2\r\n$5\r\nhello\r\n$5\r\nworld\r\n
  array: (items) => {
    return `*${items.length}\r\n` + items.map(item => serializeRESP.bulk(item)).join('');
  }
};

/**
 * Parse RESP data into command arguments
 */
function parseRESP(data) {
  const lines = data.split('\r\n');
  
  // Check if this is an array
  if (!lines[0].startsWith('*')) {
    throw new Error('Invalid RESP format');
  }
  
  // Parse array size
  const count = parseInt(lines[0].substring(1), 10);
  if (isNaN(count)) {
    throw new Error('Invalid array size');
  }
  
  // Parse array elements
  const result = [];
  let lineIndex = 1;
  
  for (let i = 0; i < count; i++) {
    // Each element should be a bulk string
    if (!lines[lineIndex].startsWith('$')) {
      throw new Error('Expected bulk string');
    }
    
    // Parse string length
    const length = parseInt(lines[lineIndex].substring(1), 10);
    if (isNaN(length)) {
      throw new Error('Invalid string length');
    }
    
    // Get string value
    result.push(lines[lineIndex + 1]);
    lineIndex += 2;
  }
  
  return result;
}

/**
 * Split incoming data into separate RESP commands
 */
function parseEvents(data) {
  const events = [];
  let buffer = data;
  let startIndex = 0;
  
  while (startIndex < buffer.length) {
    // Find the start of a command
    if (buffer[startIndex] !== '*') {
      startIndex++;
      continue;
    }
    
    // Try to extract a complete command
    try {
      // Find the end of the command size
      const sizeEndIndex = buffer.indexOf('\r\n', startIndex);
      if (sizeEndIndex === -1) break;
      
      // Parse the command size
      const size = parseInt(buffer.substring(startIndex + 1, sizeEndIndex), 10);
      if (isNaN(size)) {
        startIndex++;
        continue;
      }
      
      // Find the end of the command
      let endIndex = sizeEndIndex + 2;
      let elementsFound = 0;
      
      while (elementsFound < size && endIndex < buffer.length) {
        // Each element should start with $
        if (buffer[endIndex] !== '$') break;
        
        // Find the end of the element size
        const elemSizeEndIndex = buffer.indexOf('\r\n', endIndex);
        if (elemSizeEndIndex === -1) break;
        
        // Parse the element size
        const elemSize = parseInt(buffer.substring(endIndex + 1, elemSizeEndIndex), 10);
        if (isNaN(elemSize)) break;
        
        // Skip to the end of the element
        endIndex = elemSizeEndIndex + 2 + elemSize + 2;
        elementsFound++;
      }
      
      // If we found all elements, extract the command
      if (elementsFound === size) {
        events.push(buffer.substring(startIndex, endIndex));
        startIndex = endIndex;
      } else {
        break;
      }
    } catch (err) {
      // If we can't parse the command, move on
      startIndex++;
    }
  }
  
  return events;
}

module.exports = {
  serializeRESP,
  parseRESP,
  parseEvents
};