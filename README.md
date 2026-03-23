# Mamaset 🌸

**A privacy-first AI parenting companion for families who want to own their data.**

Mamaset uses Telegram, Venice, IPFS, and Base to help families capture memories, track milestones, and truly own their parenting data. Parents interact through Telegram, making it easy to document family life in real time. Photos are stored privately on IPFS via Pinata and minted as NFTs on Base Sepolia, creating permanent, portable proof of ownership. Venice powers all AI features — parenting advice, vision-based caption generation, and personalized bedtime stories — with zero data retention.

▶️ **[Watch the demo](https://youtu.be/B9UrIpdzKxk)**

---

## What It Does

| Feature | Description |
|---|---|
| 📸 **Photo Memories** | Send a photo + caption → stored privately on IPFS → minted as NFT on Base Sepolia |
| 📖 **Private Vault** | Browse all your saved memories, delivered securely from Pinata |
| 📅 **Milestone NFTs** | First Steps, First Words, First Food, Birthdays, Custom — each permanently on-chain |
| 🍼 **Baby Log** | Track feedings, sleep, and diapers via natural language or structured input |
| 📊 **Baby Log Chart** | 24-hour visual summary via QuickChart |
| 💬 **Ask Mama** | Private AI parenting companion powered by Venice (llama-3.3-70b) — your questions never leave your device's session |
| 📸 **Venice Vision Captions** | Skip the caption and Venice's vision AI reads your photo and suggests a warm, heartfelt caption automatically |
| 🌙 **Bedtime Stories** | Venice generates a personalized bedtime story using your baby's name and today's activity log |
| 🔗 **ERC-8004 Agent Identity** | Mamaset is registered as a verifiable on-chain agent via ERC-8004 on Base Mainnet — every NFT mint is a public receipt of agent activity on behalf of your family |

---

## Privacy Architecture

```
Parent's phone
     │
     ▼
Telegram Bot (encrypted transport)
     │
     ├─▶ Photos → Pinata Private IPFS (encrypted, access-controlled)
     │
     ├─▶ NFT Metadata → Base Sepolia (on-chain permanent record)
     │
     └─▶ AI Questions → Venice API (private inference, zero data retention)
```

**Why Venice?** Venice runs open-source models (Llama 3.3 70B) with a hard privacy guarantee: no conversation logging, no training on user data. For a parenting app handling intimate family moments, this matters.

---

## Tech Stack

- **Telegram** — Telegraf v4 bot framework
- **IPFS** — Pinata SDK v2, private file storage (`pinata.upload.private`)
- **Blockchain** — Base Sepolia (chain ID 84532), ethers.js v6
- **Smart Contract** — ERC721 + ERC721URIStorage (`MamasetMemory.sol`), deployed at `0x92ecAc1323b97aC2D596A468050275f983C29cF9`
- **AI** — Venice API (llama-3.3-70b) for private inference, OpenRouter fallback
- **Local Cache** — better-sqlite3 for baby log + Pinata file cache (handles indexing delays)
- **Charts** — QuickChart for 24hr baby activity visualizations

---

## Setup

```bash
npm install
```

Create `.env`:
```
TELEGRAM_BOT_TOKEN=...
PINATA_JWT=...
PINATA_GATEWAY=...
BASE_PRIVATE_KEY=...
BASE_CONTRACT_ADDRESS=0x92ecAc1323b97aC2D596A468050275f983C29cF9
BASE_RPC_URL=https://sepolia.base.org
VENICE_API_KEY=...
OPENROUTER_API_KEY=...   # fallback only
```

```bash
node index.js
```

---

## Smart Contract

```bash
npx hardhat compile
npx hardhat ignition deploy ./ignition/modules/MamasetMemory.js --network base-sepolia
npx hardhat test
```

Deployed on Base Sepolia: [`0x92ecAc1323b97aC2D596A468050275f983C29cF9`](https://sepolia.basescan.org/address/0x92ecAc1323b97aC2D596A468050275f983C29cF9)

---

## Hackathon Tracks

- **Venice — Private Agents, Trusted Actions** — Every AI touchpoint runs through Venice's private inference (llama-3.3-70b for text, qwen3-vl for vision). Zero data retention. Family conversations, parenting advice, and photo captions never leave the session.
- **ERC-8004 — Agents With Receipts** — Mamaset is registered as a verifiable on-chain agent via ERC-8004 on Base Mainnet. Every NFT mint is a public receipt. Agent identity, capabilities, and decision log are documented in `agent.json` and `agent_log.json`.
- **Synthesis Open Track** — End-to-end private memory preservation: private IPFS storage + Base NFTs + Venice AI, built for parents who want to own their family's data.

---

Built with love for the Synthesis Hackathon 2026. 🌸
