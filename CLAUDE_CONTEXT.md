# Mamaset v3 — Claude Context

## Project
Telegram bot for parents to preserve memories privately on-chain.
Built for the Synthesis Hackathon 2026 (Venice + SuperRare + Open Track).

## Stack
- Node.js v22 (ESM, "type": "module")
- Telegraf v4 (Telegram bot)
- Pinata SDK v2 (private IPFS uploads via `pinata.upload.private`)
- Ethers.js v6 (Base Sepolia blockchain)
- better-sqlite3 (local file-based database for baby log + Pinata cache)
- Venice API (private AI inference, llama-3.3-70b)
- OpenRouter (fallback AI if Venice key not set)

## Contract
- Address: 0x92ecAc1323b97aC2D596A468050275f983C29cF9
- Network: Base Sepolia (chain ID 84532, RPC: https://sepolia.base.org)
- ABI: ./artifacts/contracts/MamasetMemory.sol/MamasetMemory.json

## Bot Features
- 📸 Photo Memories — Pinata private upload → Base NFT mint
- 📖 My Vault — browse private photos, delivered via Pinata uploads API
- 📅 Milestones — First Steps/Words/Food/Birthday/Custom → Pinata + Base NFT
- 🍼 Baby Log — feeding/sleep/diaper tracking (NLP + structured)
- 📊 Baby Log Chart — 24hr QuickChart bar chart
- 💬 Ask Mama — Venice private AI parenting advice

## .env vars
TELEGRAM_BOT_TOKEN, PINATA_JWT, PINATA_GATEWAY,
BASE_PRIVATE_KEY, BASE_CONTRACT_ADDRESS, BASE_RPC_URL,
VENICE_API_KEY (primary AI), OPENROUTER_API_KEY (fallback AI)

## Local Database (babylog.db)
SQLite file at ./data/babylog.db — stores baby log entries and
a local cache of Pinata file IDs (so vault shows new uploads immediately).

## Key Code Notes
- callAI(messages) — tries Venice first, falls back to OpenRouter
- ESM project: use createRequire for ABI + better-sqlite3
- Hardhat config: hardhat.config.cjs (CommonJS, .cjs required)
