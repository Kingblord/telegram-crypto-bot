const express = require("express")
const { Bot } = require("grammy")

const app = express()
app.use(express.json())

// Create bot instance
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)

// Initialize bot before handling updates
async function setupBot() {
  // Initialize the bot
  await bot.init()

  // Start command
  bot.command("start", async (ctx) => {
    console.log("Start command received")
    await ctx.reply("🤖 Hello! I'm your crypto bot. I'm working on Render!")
  })

  // Echo messages
  bot.on("message:text", async (ctx) => {
    console.log("Text message received:", ctx.message.text)
    await ctx.reply(`You said: ${ctx.message.text}`)
  })

  console.log("Bot initialized successfully!")
}

// Call setup function
setupBot().catch((err) => {
  console.error("Error setting up bot:", err)
})

// Express routes
app.get("/", (req, res) => {
  res.json({
    status: "Bot is running on Render",
    timestamp: new Date().toISOString(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
  })
})

app.post("/webhook", async (req, res) => {
  try {
    console.log("Received webhook:", JSON.stringify(req.body))
    await bot.handleUpdate(req.body)
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("Webhook error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log("Bot is ready!")
})
