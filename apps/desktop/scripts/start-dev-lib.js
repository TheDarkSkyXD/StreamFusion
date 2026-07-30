"use strict";

const { randomBytes } = require("node:crypto");
const { createServer } = require("node:net");

function selectLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error("Could not select a development relay port"));
        else resolve(port);
      });
    });
  });
}

function createRelayToken() {
  return randomBytes(32).toString("hex");
}

async function createStartEnvironment(
  inheritedEnvironment,
  { selectPort = selectLoopbackPort, createToken = createRelayToken } = {}
) {
  const environment = { ...inheritedEnvironment };
  if (environment.STREAMFUSION_BROWSER_DEV !== "1") return environment;

  environment.VITE_STREAMFUSION_BROWSER_DEV = "1";
  environment.STREAMFUSION_DEV_RELAY_PORT = String(await selectPort());
  environment.STREAMFUSION_DEV_RELAY_TOKEN = createToken();
  return environment;
}

module.exports = {
  createStartEnvironment,
  selectLoopbackPort,
};
