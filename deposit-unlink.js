import { ethers } from "ethers";
import { initUnlink, createSqliteStorage, waitForConfirmation } from "@unlink-xyz/node";
import dotenv from "dotenv";
dotenv.config();

const DEPOSIT_AMOUNT = ethers.parseEther("1"); // 1 MON covers ~10 private mints
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
const wallet = new ethers.Wallet(process.env.MONAD_PRIVATE_KEY, provider);

const unlink = await initUnlink({
  chain: "monad-testnet",
  storage: createSqliteStorage({ path: "./data/unlink-wallet.db" }),
});

console.log("Depositing", ethers.formatEther(DEPOSIT_AMOUNT), "MON into Unlink shielded pool...");

const { relayId, to, calldata, value } = await unlink.deposit({
  depositor: wallet.address,
  deposits: [{ token: NATIVE, amount: DEPOSIT_AMOUNT }],
});

const tx = await wallet.sendTransaction({ to, data: calldata, value });
console.log("Tx sent:", tx.hash);
await tx.wait();
console.log("Tx confirmed. Waiting for Unlink to record deposit...");

await unlink.confirmDeposit(relayId);
console.log("✅ Deposit complete. Unlink pool funded with", ethers.formatEther(DEPOSIT_AMOUNT), "MON.");
