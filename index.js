import { PinataSDK } from "pinata";
import { Telegraf, Markup } from "telegraf";
import { ethers } from "ethers";
import { createRequire } from "module";
import dotenv from "dotenv";
dotenv.config();

const require = createRequire(import.meta.url);
const contractABI = require("./artifacts/contracts/MamasetMemory.sol/MamasetMemory.json").abi;
const Database = require("better-sqlite3");

// Pinata
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY,
});

// Base Sepolia
const baseProvider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || "https://sepolia.base.org");
const baseWallet = new ethers.Wallet(process.env.BASE_PRIVATE_KEY, baseProvider);
const baseContract = new ethers.Contract(process.env.BASE_CONTRACT_ADDRESS, contractABI, baseWallet);

// Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// SQLite baby log + local file cache
const db = new Database("./data/babylog.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS baby_profile (
    userId    TEXT PRIMARY KEY,
    babyName  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS baby_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT    NOT NULL,
    userName  TEXT,
    type      TEXT    NOT NULL,
    subtype   TEXT,
    amount    TEXT,
    duration  TEXT,
    timestamp TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pinata_files (
    id         TEXT    PRIMARY KEY,
    userId     TEXT    NOT NULL,
    name       TEXT,
    caption    TEXT,
    type       TEXT,
    created_at TEXT    NOT NULL
  );
`);

// User state: { section, step, data }
const userState = {};

// ─── Baby profile helpers ─────────────────────────────────────────────────────

function getBabyName(userId) {
  const row = db.prepare(`SELECT babyName FROM baby_profile WHERE userId = ?`).get(String(userId));
  return row ? row.babyName : null;
}

function setBabyName(userId, name) {
  db.prepare(`INSERT OR REPLACE INTO baby_profile (userId, babyName, created_at) VALUES (?, ?, ?)`)
    .run(String(userId), name, new Date().toISOString());
}

// Persistent bottom keyboard
const MAIN_KEYBOARD = Markup.keyboard([
  ["📸 Memories", "💬 Ask Mama"],
  ["📖 My Vault", "📅 Milestones", "🍼 Baby Log"],
  ["🌙 Bedtime Story"],
]).resize();

// Keyboard with skip caption row
const CAPTION_KEYBOARD = Markup.keyboard([
  ["⏭ Skip Caption"],
  ["📸 Memories", "💬 Ask Mama"],
  ["📖 My Vault", "📅 Milestones", "🍼 Baby Log"],
]).resize();

// ─── AI helper — Venice (private) with OpenRouter fallback ───────────────────

async function callAI(messages) {
  // Try Venice first (private inference — no data logging)
  if (process.env.VENICE_API_KEY) {
    try {
      const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.VENICE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b",
          messages,
        }),
      });
      const data = await res.json();
      if (data.choices?.[0]?.message?.content) {
        return { text: data.choices[0].message.content, provider: "venice" };
      }
    } catch (e) {
      console.warn("Venice AI error, falling back to OpenRouter:", e.message);
    }
  }
  // Fallback to OpenRouter
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenRouter error");
  return { text: data.choices[0].message.content, provider: "openrouter" };
}

// ─── Parenting advice ────────────────────────────────────────────────────────

async function getParentingAdvice(userMessage, userName) {
  const { text } = await callAI([
    {
      role: "system",
      content: `You are Mama, a warm and knowledgeable parenting companion inside the Mamaset app. You are talking to ${userName}. When giving parenting advice, always respond with 4-5 specific, actionable tips as a numbered list. Be warm, encouraging, and practical. Never give medical diagnoses — always suggest consulting a doctor for health concerns.`,
    },
    { role: "user", content: userMessage },
  ]);
  return text;
}

// ─── /start ──────────────────────────────────────────────────────────────────

bot.start((ctx) => {
  const userId = ctx.from.id;
  const babyName = getBabyName(userId);
  if (!babyName) {
    userState[userId] = { section: "setup", step: "awaiting_baby_name", data: {} };
    return ctx.reply("Welcome to Mamaset! 🌸\n\nBefore we start — what is your baby's name?");
  }
  userState[userId] = { section: null, step: null, data: {} };
  ctx.reply(
    `Welcome back! 🌸\n\n${babyName}'s memory vault is ready.\n\nTap a button below to get started.`,
    MAIN_KEYBOARD
  );
});

// ─── /profile ────────────────────────────────────────────────────────────────

bot.command("profile", (ctx) => {
  const userId = ctx.from.id;
  const babyName = getBabyName(userId);
  userState[userId] = { section: "setup", step: "awaiting_baby_name", data: {} };
  ctx.reply(babyName
    ? `Current baby name: *${babyName}*\n\nSend a new name to update it:`
    : "What is your baby's name?",
    { parse_mode: "Markdown" }
  );
});

// ─── Photo handler ───────────────────────────────────────────────────────────

bot.on("photo", async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId] || {};
  console.log("Photo received from", userId, "state:", state.section, state.step);

  if (state.section !== "memories" || state.step !== "awaiting_photo") {
    return ctx.reply('Tap "📸 Memories" first, then send your photo!', MAIN_KEYBOARD);
  }

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    userState[userId] = {
      section: "memories",
      step: "awaiting_caption",
      data: {
        fileLink: fileLink.href,
        timestamp: new Date().toISOString(),
        userName: ctx.from.first_name,
        userId,
      },
    };
    ctx.reply("📸 Got it! Add a caption to this memory, or tap Skip.", CAPTION_KEYBOARD);
  } catch (error) {
    console.error("Photo error:", error.message);
    ctx.reply("❌ Something went wrong. Please try again.", MAIN_KEYBOARD);
  }
});

// ─── Central text router ─────────────────────────────────────────────────────

bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  const state = userState[userId] || { section: null, step: null, data: {} };

  // Baby name setup
  if (state.section === "setup" && state.step === "awaiting_baby_name") {
    setBabyName(userId, text);
    userState[userId] = { section: null, step: null, data: {} };
    return ctx.reply(
      `Beautiful name! 🌸 Welcome to ${text}'s memory vault.\n\nTap a button below to get started.`,
      MAIN_KEYBOARD
    );
  }

  // Bedtime story prompt
  if (state.section === "bedtime" && state.step === "awaiting_prompt") {
    const prompt = text === "⏭ Skip" ? null : text;
    userState[userId] = { section: null, step: null, data: {} };
    return handleBedtimeStory(ctx, prompt);
  }

  // Skip caption button
  if (text === "⏭ Skip Caption") {
    if (state.section === "memories" && state.step === "awaiting_caption") {
      return saveMemory(ctx, "No caption");
    }
  }

  // Main navigation buttons
  if (text === "📸 Memories") {
    userState[userId] = { section: "memories", step: "awaiting_photo", data: {} };
    return ctx.reply("Send me a photo to save it forever! 🌸", MAIN_KEYBOARD);
  }
  if (text === "💬 Ask Mama") {
    userState[userId] = { section: "ask", step: "awaiting_question", data: {} };
    return ctx.reply("Ask me anything about parenting! 💛", MAIN_KEYBOARD);
  }
  if (text === "📖 My Vault") {
    userState[userId] = { section: "vault", step: null, data: {} };
    return handleVault(ctx);
  }
  if (text === "📅 Milestones") {
    userState[userId] = { section: "milestones", step: "awaiting_type", data: {} };
    return handleMilestoneMenu(ctx);
  }
  if (text === "🍼 Baby Log") {
    userState[userId] = { section: "babylog", step: "awaiting_type", data: {} };
    return handleBabyLogMenu(ctx);
  }
  if (text === "🌙 Bedtime Story") {
    userState[userId] = { section: "bedtime", step: "awaiting_prompt", data: {} };
    const babyName = getBabyName(userId) || "your baby";
    return ctx.reply(
      `🌙 What should tonight's story be about?\n\nGive me a theme or idea (e.g. _dinosaurs_, _the beach_, _a magic forest_, _butterflies_) — or just tap Skip for a surprise!`,
      { parse_mode: "Markdown", ...Markup.keyboard([["⏭ Skip"], ["📸 Memories", "💬 Ask Mama"], ["📖 My Vault", "📅 Milestones", "🍼 Baby Log"], ["🌙 Bedtime Story"]]).resize() }
    );
  }

  // Step dispatch
  if (state.section === "ask" && state.step === "awaiting_question") {
    return handleAskMama(ctx, text);
  }
  if (state.section === "memories" && state.step === "awaiting_caption") {
    return saveMemory(ctx, text);
  }
  if (state.section === "milestones" && state.step === "awaiting_notes") {
    return saveMilestone(ctx, text);
  }
  if (state.section === "milestones" && state.step === "awaiting_custom_type") {
    state.data.milestoneType = text;
    state.step = "awaiting_notes";
    userState[userId] = state;
    return ctx.reply("Add a note about this moment (or type 'none'):");
  }
  if (state.section === "babylog") {
    if (state.step === "awaiting_type") {
      return parseAndLogBabyEntry(ctx, text);
    }
    return handleBabyLogStep(ctx, state, text);
  }

  // Default
  ctx.reply("Tap a button below to get started! 👇", MAIN_KEYBOARD);
});

// ─── 📸 Memories ─────────────────────────────────────────────────────────────

async function suggestCaption(imageBuffer) {
  if (!process.env.VENICE_API_KEY) return null;
  try {
    const base64 = Buffer.from(imageBuffer).toString("base64");
    const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.2-11b-vision",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
            { type: "text", text: "Write a short, warm, one-sentence caption for this family photo. Keep it simple and heartfelt, under 15 words." },
          ],
        }],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn("Venice vision error:", e.message);
    return null;
  }
}

async function saveMemory(ctx, caption) {
  const userId = ctx.from.id;
  const state = userState[userId];
  try {
    ctx.reply("💾 Saving your memory...");
    const pending = state.data;
    const response = await fetch(pending.fileLink);
    const buffer = await response.arrayBuffer();
    const file = new File([buffer], "memory.jpg", { type: "image/jpeg" });

    // If no caption provided, ask Venice to suggest one
    let finalCaption = caption;
    if (caption === "No caption" && process.env.VENICE_API_KEY) {
      ctx.reply("🤖 Venice is reading your photo...");
      const suggestion = await suggestCaption(buffer);
      if (suggestion) {
        finalCaption = suggestion;
        ctx.reply(`✨ Caption suggestion: _"${suggestion}"_`, { parse_mode: "Markdown" });
      }
    }

    console.log("Uploading to Pinata for user", userId);
    const upload = await pinata.upload.private
      .file(file)
      .name("Memory - " + pending.timestamp)
      .keyvalues({
        caption: finalCaption,
        timestamp: pending.timestamp,
        userId: String(pending.userId),
        userName: pending.userName,
        type: "memory",
      });
    console.log("Pinata upload done, CID:", upload.cid);

    // Cache file locally so vault shows it immediately (Pinata list has indexing delay)
    db.prepare(`INSERT OR IGNORE INTO pinata_files (id, userId, name, caption, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(upload.id, String(pending.userId), "Memory - " + pending.timestamp, finalCaption, "memory", new Date().toISOString());

    const tokenURI = "https://" + process.env.PINATA_GATEWAY + "/files/" + upload.cid;
    ctx.reply("✨ Minting your memory on Base...");
    console.log("Minting on Base...");
    const tx = await baseContract.mintMemory(baseWallet.address, tokenURI);
    await tx.wait();
    console.log("Mint done, tx:", tx.hash);

    const babyName = getBabyName(userId) || "your baby";
    userState[userId] = { section: "memories", step: "awaiting_photo", data: {} };
    ctx.reply(
      `✅ Memory saved! 🌸\n📝 ${finalCaption}\n\n🔗 [View NFT on Base](https://sepolia.basescan.org/tx/${tx.hash})\n\nTap 📖 My Vault to see all of ${babyName}'s memories.`,
      { parse_mode: "Markdown", ...MAIN_KEYBOARD }
    );
  } catch (error) {
    console.error("saveMemory error:", error);
    ctx.reply("❌ Something went wrong. Please try again.", MAIN_KEYBOARD);
  }
}

// ─── 📖 My Vault ─────────────────────────────────────────────────────────────

async function handleVault(ctx) {
  try {
    ctx.sendChatAction("upload_photo");
    const userId = String(ctx.from.id);
    // Fetch ALL pages from Pinata (no keyvalue filter — include legacy files without userId)
    let allFiles = [];
    let result = await pinata.files.private.list();
    allFiles = allFiles.concat(result.files);
    while (result.next_page_token) {
      result = await pinata.files.private.list().pageToken(result.next_page_token);
      allFiles = allFiles.concat(result.files);
    }
    // Merge with locally cached files (Pinata list has indexing delay for new uploads)
    const pinataIds = new Set(allFiles.map(f => f.id));
    const localFiles = db.prepare(`SELECT * FROM pinata_files WHERE userId = ? AND type != 'milestone'`).all(userId);
    for (const lf of localFiles) {
      if (!pinataIds.has(lf.id)) {
        allFiles.push({ id: lf.id, name: lf.name, keyvalues: { userId: lf.userId, caption: lf.caption, type: lf.type }, created_at: lf.created_at });
      }
    }
    // Show files belonging to this user OR files with no userId (uploaded before tracking)
    const memories = allFiles.filter(f =>
      (f.keyvalues?.userId === userId || !f.keyvalues?.userId) &&
      f.keyvalues?.type !== "milestone"
    );
    console.log("Vault: memories (pinata:", pinataIds.size, "+ local cache):", memories.length);
    if (memories.length === 0) {
      return ctx.reply("No memories yet! Tap 📸 Memories to save your first photo. 🌸", MAIN_KEYBOARD);
    }
    // Download each image directly via Pinata uploads API and send as buffer
    const media = await Promise.all(memories.map(async (file) => {
      const res = await fetch("https://uploads.pinata.cloud/v3/files/" + file.id, {
        headers: { Authorization: "Bearer " + process.env.PINATA_JWT },
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      const caption = file.keyvalues?.caption && file.keyvalues.caption !== "No caption"
        ? file.keyvalues.caption
        : undefined;
      return { type: "photo", media: { source: buffer }, ...(caption ? { caption } : {}) };
    }));
    for (let i = 0; i < media.length; i += 10) {
      await ctx.replyWithMediaGroup(media.slice(i, i + 10));
    }
    ctx.reply("That's your vault! 📖", MAIN_KEYBOARD);
  } catch (error) {
    console.error("Vault error:", error.message);
    ctx.reply("Could not load your vault. Please try again.", MAIN_KEYBOARD);
  }
}

// ─── 📅 Milestones ───────────────────────────────────────────────────────────

function handleMilestoneMenu(ctx) {
  ctx.reply(
    "Which milestone would you like to record? 🌟",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("🚶 First Steps", "milestone_firststeps"),
        Markup.button.callback("🗣 First Words", "milestone_firstwords"),
      ],
      [
        Markup.button.callback("🍴 First Food", "milestone_firstfood"),
        Markup.button.callback("🎂 Birthday", "milestone_birthday"),
      ],
      [Markup.button.callback("✍️ Custom", "milestone_custom")],
    ])
  );
}

const MILESTONE_LABELS = {
  milestone_firststeps: "First Steps",
  milestone_firstwords: "First Words",
  milestone_firstfood: "First Food",
  milestone_birthday:  "Birthday",
};

for (const [action, label] of Object.entries(MILESTONE_LABELS)) {
  bot.action(action, (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = {
      section: "milestones",
      step: "awaiting_notes",
      data: { milestoneType: label, timestamp: new Date().toISOString() },
    };
    ctx.answerCbQuery();
    ctx.reply(`🌟 ${label}! Add a note about this moment (or type 'none'):`);
  });
}

bot.action("milestone_custom", (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = {
    section: "milestones",
    step: "awaiting_custom_type",
    data: { timestamp: new Date().toISOString() },
  };
  ctx.answerCbQuery();
  ctx.reply("What is the milestone? (e.g. 'First swim', 'First day at nursery')");
});

async function saveMilestone(ctx, notes) {
  const userId = ctx.from.id;
  const state = userState[userId];
  const { milestoneType, timestamp } = state.data;
  try {
    ctx.reply("🌟 Saving your milestone...");

    const metadataFile = new File(
      [JSON.stringify({ milestoneType, notes, timestamp, userId: String(userId) })],
      "milestone.json",
      { type: "application/json" }
    );

    const upload = await pinata.upload.private
      .file(metadataFile)
      .name("Milestone - " + milestoneType + " - " + timestamp)
      .keyvalues({
        type: "milestone",
        milestoneType,
        notes,
        timestamp,
        userId: String(userId),
        userName: ctx.from.first_name,
      });

    db.prepare(`INSERT OR IGNORE INTO pinata_files (id, userId, name, caption, type, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(upload.id, String(userId), "Milestone - " + milestoneType + " - " + timestamp, notes, "milestone", new Date().toISOString());

    const tokenURI = "https://" + process.env.PINATA_GATEWAY + "/files/" + upload.cid;
    ctx.reply("✨ Minting milestone NFT on Base...");
    const tx = await baseContract.mintMemory(baseWallet.address, tokenURI);
    await tx.wait();

    const babyName = getBabyName(userId) || "your baby";
    userState[userId] = { section: "milestones", step: "awaiting_type", data: {} };
    ctx.reply(
      `✅ Milestone saved forever! 🌟\n\n🏷 ${babyName}'s ${milestoneType}\n📝 ${notes}\n\n🔗 [View NFT on Base](https://sepolia.basescan.org/tx/${tx.hash})`,
      { parse_mode: "Markdown", ...MAIN_KEYBOARD }
    );
  } catch (error) {
    console.error("saveMilestone error:", error);
    ctx.reply("❌ Something went wrong. Please try again.", MAIN_KEYBOARD);
  }
}

// ─── 🍼 Baby Log ─────────────────────────────────────────────────────────────

function handleBabyLogMenu(ctx) {
  ctx.reply(
    "What would you like to log? 🍼",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("🍼 Feeding", "babylog_feeding"),
        Markup.button.callback("😴 Sleep", "babylog_sleep"),
        Markup.button.callback("💩 Diaper", "babylog_diaper"),
      ],
      [Markup.button.callback("📊 Today's Chart", "babylog_chart")],
    ])
  );
}

bot.action("babylog_chart", async (ctx) => {
  ctx.answerCbQuery();
  await sendBabyLogChart(ctx);
});

bot.action("babylog_feeding", (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = {
    section: "babylog",
    step: "feeding_amount",
    data: { type: "feeding", timestamp: new Date().toISOString() },
  };
  ctx.answerCbQuery();
  ctx.reply("How much did baby drink? (e.g. 90ml, 3oz)");
});

bot.action("babylog_sleep", (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = {
    section: "babylog",
    step: "sleep_duration",
    data: { type: "sleep", timestamp: new Date().toISOString() },
  };
  ctx.answerCbQuery();
  ctx.reply("How long did baby sleep? (e.g. 2h30m, 45min)");
});

bot.action("babylog_diaper", (ctx) => {
  const userId = ctx.from.id;
  userState[userId] = {
    section: "babylog",
    step: "diaper_type",
    data: { type: "diaper", timestamp: new Date().toISOString() },
  };
  ctx.answerCbQuery();
  ctx.reply(
    "What kind of diaper?",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("💧 Wet", "diaper_wet"),
        Markup.button.callback("💩 Dirty", "diaper_dirty"),
        Markup.button.callback("Both", "diaper_both"),
      ],
    ])
  );
});

for (const dtype of ["wet", "dirty", "both"]) {
  bot.action("diaper_" + dtype, (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId] || { data: { type: "diaper", timestamp: new Date().toISOString() } };
    state.data.subtype = dtype;
    ctx.answerCbQuery();
    saveBabyLog(ctx, state.data);
  });
}

bot.action("feeding_breast", (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId] || { data: {} };
  state.data.subtype = "breast";
  state.step = "feeding_breast_side";
  userState[userId] = state;
  ctx.answerCbQuery();
  ctx.reply(
    "Which side?",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("⬅️ Left", "breast_left"),
        Markup.button.callback("➡️ Right", "breast_right"),
        Markup.button.callback("↔️ Both", "breast_both"),
      ],
    ])
  );
});

for (const side of ["left", "right", "both"]) {
  bot.action("breast_" + side, (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId] || { data: {} };
    state.data.subtype = "breast-" + side;
    ctx.answerCbQuery();
    saveBabyLog(ctx, state.data);
  });
}

bot.action("feeding_formula", (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId] || { data: {} };
  state.data.subtype = "formula";
  ctx.answerCbQuery();
  saveBabyLog(ctx, state.data);
});

function handleBabyLogStep(ctx, state, text) {
  const userId = ctx.from.id;

  if (state.step === "feeding_amount") {
    state.data.amount = text;
    state.step = "feeding_subtype";
    userState[userId] = state;
    return ctx.reply(
      "Breast or formula?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("🤱 Breast", "feeding_breast"),
          Markup.button.callback("🍼 Formula", "feeding_formula"),
        ],
      ])
    );
  }

  if (state.step === "sleep_duration") {
    state.data.duration = text;
    return saveBabyLog(ctx, state.data);
  }

  handleBabyLogMenu(ctx);
}

function saveBabyLog(ctx, data) {
  const userId = ctx.from.id;
  try {
    const stmt = db.prepare(`
      INSERT INTO baby_log (userId, userName, type, subtype, amount, duration, timestamp)
      VALUES (@userId, @userName, @type, @subtype, @amount, @duration, @timestamp)
    `);
    stmt.run({
      userId: String(userId),
      userName: ctx.from.first_name,
      type: data.type,
      subtype: data.subtype || null,
      amount: data.amount || null,
      duration: data.duration || null,
      timestamp: data.timestamp || new Date().toISOString(),
    });

    userState[userId] = { section: "babylog", step: "awaiting_type", data: {} };

    let summary = "";
    if (data.type === "feeding") {
      const sideLabels = { "breast-left": "Left breast", "breast-right": "Right breast", "breast-both": "Both breasts", "formula": "Formula" };
      const source = sideLabels[data.subtype] || data.subtype || "";
      summary = `🍼 ${source} — ${data.amount || ""}`;
    }
    if (data.type === "sleep")   summary = `😴 Sleep — ${data.duration || ""}`;
    if (data.type === "diaper")  summary = `💩 Diaper — ${data.subtype || ""}`;

    ctx.reply("✅ Logged! " + summary, MAIN_KEYBOARD);
  } catch (error) {
    console.error("saveBabyLog error:", error);
    ctx.reply("❌ Could not save log. Please try again.", MAIN_KEYBOARD);
  }
}

// ─── 📊 Baby Log Chart ───────────────────────────────────────────────────────

async function sendBabyLogChart(ctx) {
  const userId = String(ctx.from.id);
  // Use last 24 hours to handle timezone differences
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const logs = db.prepare(
    `SELECT * FROM baby_log WHERE userId = ? AND timestamp >= ? ORDER BY timestamp ASC`
  ).all(userId, since);

  if (logs.length === 0) {
    return ctx.reply("No logs in the last 24 hours! Tap 🍼 Baby Log to start tracking.", MAIN_KEYBOARD);
  }

  const feedings = logs.filter(l => l.type === "feeding");
  const sleeps   = logs.filter(l => l.type === "sleep");
  const diapers  = logs.filter(l => l.type === "diaper");
  const sideLabels = { "breast-left": "Left", "breast-right": "Right", "breast-both": "Both", "formula": "Formula" };

  // Build text summary as separate message (avoids caption length/Markdown limits)
  let text = "📊 Last 24 Hours\n\n";

  if (feedings.length) {
    text += `🍼 Feedings (${feedings.length})\n`;
    feedings.forEach(f => {
      const time = new Date(f.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const src = sideLabels[f.subtype] || f.subtype || "";
      text += `  ${time} — ${src}${f.amount ? " " + f.amount : ""}\n`;
    });
    text += "\n";
  }

  if (sleeps.length) {
    text += `😴 Sleep (${sleeps.length})\n`;
    sleeps.forEach(s => {
      const time = new Date(s.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      text += `  ${time} — ${s.duration || ""}\n`;
    });
    text += "\n";
  }

  if (diapers.length) {
    const wet   = diapers.filter(d => d.subtype === "wet").length;
    const dirty = diapers.filter(d => d.subtype === "dirty").length;
    const both  = diapers.filter(d => d.subtype === "both").length;
    text += `💩 Diapers (${diapers.length})\n`;
    text += `  Wet: ${wet + both}   Dirty: ${dirty + both}\n`;
  }

  // Send text first, then chart image
  await ctx.reply(text, MAIN_KEYBOARD);

  const chartConfig = {
    type: "bar",
    data: {
      labels: ["Feedings", "Sleep", "Diapers"],
      datasets: [{
        data: [feedings.length, sleeps.length, diapers.length],
        backgroundColor: ["#FFB347", "#87CEEB", "#DDA0DD"],
      }],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: "Last 24 Hours" } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  };

  const chartUrl = "https://quickchart.io/chart?c=" + encodeURIComponent(JSON.stringify(chartConfig)) + "&w=500&h=300";
  ctx.replyWithPhoto(chartUrl);
}

// ─── 🗣 Natural language baby log ────────────────────────────────────────────

async function parseAndLogBabyEntry(ctx, text) {
  try {
    ctx.sendChatAction("typing");
    const { text: aiText } = await callAI([
      {
        role: "system",
        content: `You are a baby log parser. Extract structured data from natural language baby log entries and return ONLY valid JSON, nothing else.

For feeding: {"type":"feeding","subtype":"formula"|"breast-left"|"breast-right"|"breast-both","amount":"90ml"}
For sleep: {"type":"sleep","duration":"2h30m"}
For diaper: {"type":"diaper","subtype":"wet"|"dirty"|"both"}
If the input is not a baby log entry, return: {"type":"unknown"}

Examples:
"fed 90ml formula" → {"type":"feeding","subtype":"formula","amount":"90ml"}
"breastfed left side 10 mins" → {"type":"feeding","subtype":"breast-left","amount":"10 mins"}
"napped for 45 minutes" → {"type":"sleep","duration":"45min"}
"wet diaper" → {"type":"diaper","subtype":"wet"}
"poopy nappy" → {"type":"diaper","subtype":"dirty"}`,
      },
      { role: "user", content: text },
    ]);
    const clean = aiText.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(clean);

    if (parsed.type === "unknown") {
      return handleBabyLogMenu(ctx);
    }

    saveBabyLog(ctx, { ...parsed, timestamp: new Date().toISOString() });
  } catch {
    handleBabyLogMenu(ctx);
  }
}

// ─── 💬 Ask Mama ─────────────────────────────────────────────────────────────

async function handleAskMama(ctx, text) {
  try {
    ctx.sendChatAction("typing");
    const advice = await getParentingAdvice(text, ctx.from.first_name);
    ctx.reply(advice, MAIN_KEYBOARD);
  } catch (error) {
    console.error("OpenRouter error:", error.message);
    ctx.reply("💛 I am having trouble connecting right now. Please try again!", MAIN_KEYBOARD);
  }
}

// ─── 🌙 Bedtime Story ─────────────────────────────────────────────────────────

async function handleBedtimeStory(ctx, prompt = null) {
  const userId = String(ctx.from.id);
  const babyName = getBabyName(ctx.from.id) || "your little one";
  try {
    ctx.sendChatAction("typing");
    ctx.reply(prompt
      ? `🌙 Writing a story about ${prompt} for ${babyName}...`
      : `🌙 Writing a bedtime story just for ${babyName}...`
    );

    // Pull today's baby log for context
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const logs = db.prepare(`SELECT * FROM baby_log WHERE userId = ? AND timestamp >= ? ORDER BY timestamp ASC`).all(userId, since);

    let dayContext = "";
    if (logs.length > 0) {
      const feedings = logs.filter(l => l.type === "feeding").length;
      const sleeps = logs.filter(l => l.type === "sleep");
      const diapers = logs.filter(l => l.type === "diaper").length;
      const totalSleep = sleeps.map(s => s.duration || "").filter(Boolean).join(", ");
      dayContext = `Today ${babyName} had ${feedings} feeding${feedings !== 1 ? "s" : ""}${totalSleep ? ", slept " + totalSleep : ""}, and ${diapers} diaper change${diapers !== 1 ? "s" : ""}.`;
    }

    const { text } = await callAI([
      {
        role: "system",
        content: `You are a gentle bedtime storyteller for babies and toddlers. Write warm, soothing, imaginative bedtime stories that are 150-200 words. Use the baby's name throughout. End with them drifting off to sleep peacefully.`,
      },
      {
        role: "user",
        content: `Write a bedtime story for ${babyName}. ${dayContext}${prompt ? ` Tonight's theme: ${prompt}.` : ""} Make it cozy and sleepy.`,
      },
    ]);

    ctx.reply("🌙 *Bedtime Story*\n\n" + text, { parse_mode: "Markdown", ...MAIN_KEYBOARD });
  } catch (error) {
    console.error("Bedtime story error:", error.message);
    ctx.reply("💛 Could not generate a story right now. Try again!", MAIN_KEYBOARD);
  }
}

// ─── Launch ───────────────────────────────────────────────────────────────────

bot.launch();
console.log("🌸 Mamaset bot is running...");
