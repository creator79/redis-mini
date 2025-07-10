const net = require("net");

const server = net.createServer((connection) => {
  console.log("Client connected");

  connection.on("data", (data) => {
    console.log("Received:", data.toString());
    connection.write("+PONG\r\n");
  });

  connection.on("end", () => {
    console.log("Client disconnected");
  });
});

server.listen(6379, "127.0.0.1", () => {
  console.log("Server listening on port 6379");
});
