require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    monad: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: [process.env.MONAD_PRIVATE_KEY]
    },
    baseSepolia: {
      url: process.env.BASE_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: [process.env.BASE_PRIVATE_KEY]
    }
  }
};
