const fs = require("fs");

const hex = "5245444953fb666f6f6261720000000000000000ff";
const buffer = Buffer.from(hex, "hex");

fs.writeFileSync("dump.rdb", buffer);

console.log("dump.rdb written");
