import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
const wallet = new ethers.Wallet(process.env.MONAD_PRIVATE_KEY, provider);

async function main() {
  const balance = await provider.getBalance(wallet.address);
  console.log("Wallet address:", wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "MON");
}

main();
