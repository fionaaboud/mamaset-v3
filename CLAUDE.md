# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mamaset is a Telegram bot for parents to preserve memories privately on-chain. Parents send photos via Telegram, which are uploaded to IPFS (Pinata) and minted as NFTs on the Monad testnet — optionally using the Unlink privacy layer so minting is done from a burner wallet.

## Running the Bot

```bash
node index.js
```

## Smart Contract Commands

```bash
# Compile contracts
npx hardhat compile

# Deploy to Monad testnet
npx hardhat ignition deploy ./ignition/modules/MamasetMemory.js --network monad

# Run contract tests
npx hardhat test

# Check wallet balance on Monad
node monad.js
```

## Environment Variables

Required in `.env`:
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `PINATA_JWT` — Pinata API JWT
- `PINATA_GATEWAY` — Pinata IPFS gateway hostname
- `MONAD_PRIVATE_KEY` — wallet private key for minting
- `MONAD_CONTRACT_ADDRESS` — deployed contract address (currently `0x92ecAc1323b97aC2D596A468050275f983C29cF9`)
- `MINI_APP_URL` — Telegram Mini App URL
- `OPENROUTER_API_KEY` — OpenRouter key for parenting advice AI (GPT-4o-mini via OpenRouter)

## Architecture

### Bot Flow (`index.js`)
1. User sends a photo → bot stores pending upload in `pendingUploads[userId]`
2. User sends a caption (or `/skip`) → `saveMemory()` is called
3. Photo is fetched from Telegram and uploaded to IPFS via Pinata
4. NFT is minted on Monad:
   - **Private path** (preferred): via `mintPrivately()` using Unlink burner wallet — funds burner, encodes calldata, sends transaction, sweeps remaining gas back
   - **Public fallback**: direct `contract.mintMemory()` call if Unlink fails to initialize
5. Any text message without a pending upload triggers the parenting advice AI via OpenRouter

### Unlink Privacy Layer
`initUnlinkWallet()` runs at startup and stores the SQLite wallet at `./data/unlink-wallet.db`. If Unlink fails, the bot falls back to direct public minting without crashing.

### Smart Contract (`contracts/MamasetMemory.sol`)
ERC721 with `ERC721URIStorage`. The `mintMemory(address to, string tokenURI)` function is `onlyOwner` — the owner is the wallet from `MONAD_PRIVATE_KEY`. Each NFT's tokenURI points to the Pinata IPFS gateway URL.

### Module System
The project uses ESM (`"type": "module"`). `hardhat.config.cjs` uses CommonJS (`.cjs` extension required by Hardhat). Contract ABI is loaded in `index.js` via `createRequire` for CJS-style require inside ESM.

## Key File Editing Note

When rewriting `index.js` with a heredoc in bash, use `MAMAEOF` as the delimiter (not `EOF`) to avoid conflicts with content inside the file.
