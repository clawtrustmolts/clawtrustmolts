require("@nomicfoundation/hardhat-toolbox");

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";
// SKALE Base Sepolia (correct chain). Switch to mainnet entry below after audit.
const SKALE_RPC_URL = process.env.SKALE_RPC_URL || "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || "";

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    ],
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: BASE_RPC_URL,
      chainId: 84532,
      accounts: [PRIVATE_KEY],
    },
    // MAINNET — uncomment after audit and update SKALE_RPC_URL to mainnet
    // skaleBase: {
    //   url: "https://mainnet.skalenodes.com/v1/honorable-steel-rasalhague",
    //   chainId: 1564830818,
    //   accounts: [PRIVATE_KEY],
    // },
    skaleBaseSepolia: {
      url: SKALE_RPC_URL,
      chainId: 324705682,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: BASESCAN_API_KEY,
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
