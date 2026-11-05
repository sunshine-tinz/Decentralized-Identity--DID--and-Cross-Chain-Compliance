require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type {import("hardhat").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // Paris keeps the bytecode deployable on chains that have not activated
      // Cancun; OpenZeppelin 5.0.2 does not need `mcopy`.
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
    },
  },
};
