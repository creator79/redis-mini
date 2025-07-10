const net = require("net");

console.log("Server starting...");

// Simple RESP parser for Array of Bulk Strings
function parseRESP(buffer) {
  const str = buffer.toString();
  const lines = str.split('\r\n');
  
  if (!lines[0].startsWith('*')) {
    throw new Error('Expected Array');
  }
  
  const count = parseInt(lines[0].slice(1), 10);
  const result = [];
  let i = 1;
  
  while (result.length < count && i < lines.length) {
    if (!lines[i].startsWith('$')) {
      throw new Error('Expected Bulk String');
    }
    const len = parseInt(lines[i].slice(1), 10);
    const val = lines[i + 1];
    if (val.length !== len) {
      // In real Redis, it can be split across packets, but we ignore that for now.
    }
    result.push(val);
    i += 2;
  }

  return result;
}

const server = net.createServer((connection) => {
  connection.on("data", (data) => {
    try {
      const commandParts = parseRESP(data);
      const command = commandParts[0].toUpperCase();

      if (command === "PING") {
        connection.write("+PONG\r\n");
      } else if (command === "ECHO") {
        const message = commandParts[1];
        connection.write(`$${message.length}\r\n${message}\r\n`);
      } else {
        connection.write("-ERR unknown command\r\n");
      }
    } catch (err) {
      console.log("Parse error:", err);
      connection.write("-ERR parsing error\r\n");
    }
  });

  connection.on("end", () => {
    console.log("Client disconnected");
  });
});

server.listen(6379, "127.0.0.1", () => {
  console.log("Server listening on port 6379");
});
