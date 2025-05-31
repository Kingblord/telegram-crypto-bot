const express = require("express")
const { Bot } = require("grammy")

const app = express()
app.use(express.json())

// Available tokens with contract addresses
const AVAILABLE_TOKENS = [
  { name: "XTM", symbol: "XTM", contractAddress: "0xcd1faff6e578fa5cac469d2418c95671ba1a62fe" },
  { name: "wBitcoin", symbol: "wBTC", contractAddress: "0xa01b9cafe2230093fbf0000b43701e03717f77ce" },
  { name: "Doge coin", symbol: "DOGE", contractAddress: "0xba2ae424d960c26247dd6c32edc70b295c744c43" },
  { name: "Btcbr", symbol: "BTCBR", contractAddress: "0x55d6043859dbe45e0a2571ea64b3855062fd86d8" },
  { name: "Ethm", symbol: "ETHM", contractAddress: "0x0b33542240d6fa323c796749f6d6869fdb7f13ca" },
  { name: "Tentum USD.T", symbol: "USDT", contractAddress: "0x79b9316d3fb45273b19cfb570aa144999d896f4e" },
  { name: "T99", symbol: "T99", contractAddress: "0xe9a5c635c51002fa5f377f956a8ce58573d63d91" },
  { name: "Thoreum V2", symbol: "THOREUM", contractAddress: "0xf2a92bc1cf798ff4de14502a9c6fda58865e8d5d" },
  { name: "PEPE", symbol: "PEPE", contractAddress: "0xef00278d7eadf3b2c05267a2f185e468ad7eab7d" },
  { name: "Metis", symbol: "METIS", contractAddress: "0xe552fb52a4f19e44ef5a967632dbc320b0820639" },
  { name: "Lusd", symbol: "LUSD", contractAddress: "0x23e8a70534308a4aaf76fb8c32ec13d17a3bd89e" },
]

// In-memory storage (use database in production)
const userSessions = new Map()
const transactions = new Map()
const messages = new Map()
const users = new Map()

// IMPORTANT: Replace with your actual Telegram user ID from @userinfobot
const ADMIN_IDS = new Set(["7763673217"]) // Get this from @userinfobot

// Create bot instance
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)

// Helper functions
function isValidContractAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

function findTokenByContract(contractAddress) {
  return AVAILABLE_TOKENS.find((token) => token.contractAddress.toLowerCase() === contractAddress.toLowerCase())
}

function getTokenDisplayInfo(token) {
  return `📋 Token Information:
🏷️ Name: ${token.name}
🔤 Symbol: ${token.symbol}
📍 Contract: \`${token.contractAddress}\``
}

function generateTransactionId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 5)
}

function getUserInfo(ctx) {
  const user = ctx.from
  return user?.username ? `@${user.username}` : user?.first_name || "Unknown User"
}

function isAdmin(userId) {
  return ADMIN_IDS.has(userId.toString())
}

// Initialize bot before handling updates
async function setupBot() {
  await bot.init()

  // Start command
  bot.command("start", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      // Reset user session
      userSessions.set(userId, { step: "start" })

      // Save user info
      const user = ctx.from
      users.set(userId, {
        id: userId,
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        created_at: new Date().toISOString(),
      })

      await ctx.reply("🤖 Welcome to the Crypto Exchange Bot!\n\nWhat would you like to do?", {
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })

      userSessions.set(userId, { step: "select_type" })
      console.log(`User ${getUserInfo(ctx)} started the bot`)
    } catch (error) {
      console.error("Error in start command:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle Buy/Sell selection
  bot.hears(["💰 Buy Crypto", "💱 Sell Crypto"], async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "select_type") {
        await ctx.reply("Please start over with /start")
        return
      }

      const transactionType = ctx.message?.text?.includes("Buy") ? "buy" : "sell"
      session.transactionType = transactionType
      session.step = "select_coin"
      userSessions.set(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Search by Contract Address" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      await ctx.reply(`Please select which token you want to ${transactionType}:`, {
        reply_markup: {
          keyboard: tokenButtons,
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })

      console.log(`User ${getUserInfo(ctx)} selected ${transactionType}`)
    } catch (error) {
      console.error("Error in transaction type selection:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle Available Tokens
  bot.hears("📋 Available Tokens", async (ctx) => {
    try {
      let tokenList = "📋 **Available Tokens:**\n\n"

      AVAILABLE_TOKENS.forEach((token, index) => {
        tokenList += `${index + 1}. **${token.name}** (${token.symbol})\n`
        tokenList += `   Contract: \`${token.contractAddress}\`\n\n`
      })

      tokenList += "You can also search by any contract address using the 🔍 Search option!"

      await ctx.reply(tokenList, {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error showing tokens:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle My Transactions
  bot.hears("📊 My Transactions", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const userTransactions = Array.from(transactions.values())
        .filter((t) => t.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10) // Show last 10 transactions

      if (userTransactions.length === 0) {
        await ctx.reply("📊 You have no transactions yet.\n\nStart trading by selecting Buy or Sell!", {
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Menu" }]],
            resize_keyboard: true,
          },
        })
        return
      }

      let transactionList = "📊 **Your Recent Transactions:**\n\n"

      userTransactions.forEach((tx, index) => {
        const statusEmoji =
          {
            pending: "⏳",
            in_progress: "🔄",
            completed: "✅",
            cancelled: "❌",
          }[tx.status] || "❓"

        transactionList += `${index + 1}. ${statusEmoji} **${tx.type.toUpperCase()}** ${tx.coin}\n`
        transactionList += `   ID: #${tx.id}\n`
        transactionList += `   Status: ${tx.status}\n`
        transactionList += `   Date: ${new Date(tx.createdAt).toLocaleDateString()}\n\n`
      })

      await ctx.reply(transactionList, {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error showing transactions:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle Back to Menu
  bot.hears("🔙 Back to Menu", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      userSessions.set(userId, { step: "select_type" })

      await ctx.reply("🤖 Welcome back! What would you like to do?", {
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error going back to menu:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle search by contract address
  bot.hears("🔍 Search by Contract Address", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "select_coin") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "custom_contract"
      userSessions.set(userId, session)

      await ctx.reply(
        "🔍 Please send the contract address of the token you want to trade:\n\nExample: 0x1234567890abcdef1234567890abcdef12345678",
        {
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Token List" }]],
            resize_keyboard: true,
          },
        },
      )
    } catch (error) {
      console.error("Error in contract search:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle back to token list
  bot.hears("🔙 Back to Token List", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "custom_contract") {
        await ctx.reply("Please start over with /start")
        return
      }

      if (!session.transactionType) {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "select_coin"
      userSessions.set(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Search by Contract Address" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      await ctx.reply(`Please select which token you want to ${session.transactionType}:`, {
        reply_markup: {
          keyboard: tokenButtons,
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error going back to token list:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle token selection from predefined list
  bot.hears(/^[A-Z]+ - /, async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "select_coin") return

      const selectedText = ctx.message?.text || ""
      const symbol = selectedText.split(" - ")[0]
      const selectedToken = AVAILABLE_TOKENS.find((token) => token.symbol === symbol)

      if (!selectedToken) {
        await ctx.reply("Invalid token selection. Please try again.")
        return
      }

      session.coin = selectedToken.name
      session.contractAddress = selectedToken.contractAddress
      session.step = "confirm"
      userSessions.set(userId, session)

      const tokenInfo = getTokenDisplayInfo(selectedToken)

      await ctx.reply(
        `${tokenInfo}\n\nYou want to ${session.transactionType} ${selectedToken.name}. Is this correct?`,
        {
          reply_markup: {
            keyboard: [[{ text: "✅ Confirm" }, { text: "❌ Cancel" }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
          parse_mode: "Markdown",
        },
      )

      console.log(`User ${getUserInfo(ctx)} selected token ${selectedToken.name}`)
    } catch (error) {
      console.error("Error in token selection:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Handle confirmation
  bot.hears(["✅ Confirm", "❌ Cancel"], async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "confirm") {
        await ctx.reply("Please start over with /start")
        return
      }

      if (ctx.message?.text === "❌ Cancel") {
        userSessions.set(userId, { step: "select_type" })
        await ctx.reply("Transaction cancelled. What would you like to do?", {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
              [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
            ],
            resize_keyboard: true,
          },
        })
        return
      }

      if (!session.transactionType || !session.coin) {
        await ctx.reply("Missing transaction details. Please start over with /start")
        return
      }

      // Create transaction
      const transactionId = generateTransactionId()
      const transaction = {
        id: transactionId,
        userId: userId,
        type: session.transactionType,
        coin: session.coin,
        contractAddress: session.contractAddress,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      transactions.set(transactionId, transaction)
      session.transactionId = transactionId
      session.step = "chat"
      userSessions.set(userId, session)

      await ctx.reply(
        `✅ Your ${session.transactionType} request for ${session.coin} has been submitted!\n\n🆔 Transaction ID: #${transactionId}\n\nAn admin will contact you shortly. You can send messages here and they will be forwarded to our admin.`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔄 Start Over" }]],
            resize_keyboard: true,
          },
        },
      )

      // Notify all admins
      const userInfo = getUserInfo(ctx)
      const tokenInfo = session.contractAddress ? `\n📍 Contract: \`${session.contractAddress}\`` : ""

      for (const adminId of ADMIN_IDS) {
        try {
          await bot.api.sendMessage(
            Number.parseInt(adminId),
            `🚨 **New ${session.transactionType} request!**\n\n👤 User: ${userInfo}\n🪙 Token: ${session.coin}${tokenInfo}\n🆔 Transaction ID: #${transactionId}\n\nUse /respond ${transactionId} to start chatting with the user.`,
            { parse_mode: "Markdown" },
          )
        } catch (adminError) {
          console.error(`Error notifying admin ${adminId}:`, adminError)
        }
      }

      console.log(`Transaction ${transactionId} created for user ${getUserInfo(ctx)}`)
    } catch (error) {
      console.error("Error in confirmation:", error)
      await ctx.reply("Sorry, there was an error processing your request. Please try again.")
    }
  })

  // Handle regular text messages
  bot.on("message:text", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}

      // Handle custom contract address input
      if (session.step === "custom_contract") {
        const contractAddress = ctx.message?.text?.trim()

        if (!contractAddress || !isValidContractAddress(contractAddress)) {
          await ctx.reply(
            "❌ Invalid contract address format!\n\nPlease provide a valid Ethereum contract address starting with 0x followed by 40 hexadecimal characters.\n\nExample: 0x1234567890abcdef1234567890abcdef12345678",
          )
          return
        }

        const knownToken = findTokenByContract(contractAddress)
        let tokenInfo
        let tokenName

        if (knownToken) {
          tokenInfo = getTokenDisplayInfo(knownToken)
          tokenName = knownToken.name
        } else {
          tokenInfo = `📋 Custom Token Information:
🏷️ Name: Unknown Token
🔤 Symbol: Unknown
📍 Contract: \`${contractAddress}\`

⚠️ This is a custom token not in our predefined list.`
          tokenName = `Custom Token (${contractAddress.substring(0, 8)}...)`
        }

        session.coin = tokenName
        session.contractAddress = contractAddress
        session.step = "confirm"
        userSessions.set(userId, session)

        await ctx.reply(`${tokenInfo}\n\nYou want to ${session.transactionType} this token. Is this correct?`, {
          reply_markup: {
            keyboard: [[{ text: "✅ Confirm" }, { text: "❌ Cancel" }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
          parse_mode: "Markdown",
        })
        return
      }

      // Handle "Start Over" button
      if (ctx.message?.text === "🔄 Start Over") {
        userSessions.set(userId, { step: "select_type" })
        await ctx.reply("Starting over. What would you like to do?", {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
              [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
            ],
            resize_keyboard: true,
          },
        })
        return
      }

      // Handle chat messages from users in active transactions
      if (session.step === "chat" && session.transactionId) {
        const messageText = ctx.message?.text
        if (!messageText) return

        // Store message
        const messageId = Date.now().toString()
        messages.set(messageId, {
          transactionId: session.transactionId,
          senderId: userId,
          messageText: messageText,
          createdAt: new Date().toISOString(),
        })

        // Forward to all admins
        for (const adminId of ADMIN_IDS) {
          try {
            await bot.api.sendMessage(
              Number.parseInt(adminId),
              `💬 **Message from user** (Transaction #${session.transactionId}):\n\n"${messageText}"\n\nReply using /respond ${session.transactionId}`,
              { parse_mode: "Markdown" },
            )
          } catch (adminError) {
            console.error(`Error forwarding to admin ${adminId}:`, adminError)
          }
        }

        await ctx.reply("📤 Your message has been sent to our admin. Please wait for a response.")
        console.log(`Message forwarded from user ${getUserInfo(ctx)} in transaction ${session.transactionId}`)
        return
      }

      // Handle admin messages
      if (isAdmin(userId)) {
        const messageText = ctx.message?.text
        if (!messageText) return

        // Get active transactions
        const activeTransactions = Array.from(transactions.values()).filter(
          (t) => t.status === "pending" || t.status === "in_progress",
        )

        if (activeTransactions.length === 0) {
          await ctx.reply(
            "There are no active transactions. Use /respond [transaction_id] to respond to a specific transaction.",
          )
          return
        }

        if (activeTransactions.length === 1) {
          const transaction = activeTransactions[0]

          // Store admin message
          const messageId = Date.now().toString()
          messages.set(messageId, {
            transactionId: transaction.id,
            senderId: userId,
            messageText: messageText,
            createdAt: new Date().toISOString(),
          })

          // Forward to user
          await bot.api.sendMessage(transaction.userId, `👨‍💼 **Admin:** ${messageText}`, {
            parse_mode: "Markdown",
          })
          await ctx.reply(`📤 Message sent to user (Transaction #${transaction.id})`)
          console.log(`Admin message sent to user in transaction ${transaction.id}`)
          return
        }

        await ctx.reply(
          "There are multiple active transactions. Please use /respond [transaction_id] to specify which transaction you want to respond to.",
        )
        return
      }

      // Default response for unrecognized messages
      await ctx.reply("Please start over with /start or use the menu buttons.")
    } catch (error) {
      console.error("Error handling message:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Admin command: respond to specific transaction
  bot.command("respond", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isAdmin(userId)) {
        await ctx.reply("You are not authorized to use this command.")
        return
      }

      const transactionId = ctx.match
      if (!transactionId) {
        await ctx.reply("Please provide a valid transaction ID: /respond [transaction_id]")
        return
      }

      const transaction = transactions.get(transactionId)
      if (!transaction) {
        await ctx.reply("Transaction not found.")
        return
      }

      // Update transaction status
      transaction.status = "in_progress"
      transaction.updatedAt = new Date().toISOString()
      transactions.set(transactionId, transaction)

      const user = users.get(transaction.userId)
      const userInfo = user?.username ? `@${user.username}` : user?.first_name || "Unknown"
      const contractInfo = transaction.contractAddress ? `\n📍 Contract: \`${transaction.contractAddress}\`` : ""

      await ctx.reply(
        `✅ You are now connected to user ${userInfo} for ${transaction.type} ${transaction.coin}${contractInfo}\n\n🆔 Transaction #${transactionId}\n\nAll messages you send will be forwarded to the user. Type /end ${transactionId} to end the conversation.`,
        { parse_mode: "Markdown" },
      )

      // Notify user that admin has responded
      await bot.api.sendMessage(
        transaction.userId,
        `👨‍💼 An admin has connected to your request and will assist you with your ${transaction.type} of ${transaction.coin}. You can continue chatting here.`,
      )

      console.log(`Admin ${userId} connected to transaction ${transactionId}`)
    } catch (error) {
      console.error("Error in respond command:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Admin command: end conversation
  bot.command("end", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isAdmin(userId)) {
        await ctx.reply("You are not authorized to use this command.")
        return
      }

      const transactionId = ctx.match
      if (!transactionId) {
        await ctx.reply("Please provide a valid transaction ID: /end [transaction_id]")
        return
      }

      const transaction = transactions.get(transactionId)
      if (!transaction) {
        await ctx.reply("Transaction not found.")
        return
      }

      // Update transaction status
      transaction.status = "completed"
      transaction.updatedAt = new Date().toISOString()
      transactions.set(transactionId, transaction)

      await ctx.reply(`✅ Conversation for transaction #${transactionId} has been ended and marked as completed.`)

      // Notify user that conversation has ended
      await bot.api.sendMessage(
        transaction.userId,
        "✅ The admin has ended the conversation. Your transaction has been marked as completed. Type /start to begin a new transaction.",
      )

      console.log(`Transaction ${transactionId} completed by admin ${userId}`)
    } catch (error) {
      console.error("Error in end command:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Admin command: list active transactions
  bot.command("list", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isAdmin(userId)) {
        await ctx.reply("You are not authorized to use this command.")
        return
      }

      const activeTransactions = Array.from(transactions.values())
        .filter((t) => t.status === "pending" || t.status === "in_progress")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

      if (activeTransactions.length === 0) {
        await ctx.reply("📋 No active transactions.")
        return
      }

      let transactionList = "📋 **Active Transactions:**\n\n"

      activeTransactions.forEach((tx, index) => {
        const user = users.get(tx.userId)
        const userInfo = user?.username ? `@${user.username}` : user?.first_name || "Unknown"
        const statusEmoji = tx.status === "pending" ? "⏳" : "🔄"

        transactionList += `${index + 1}. ${statusEmoji} **${tx.type.toUpperCase()}** ${tx.coin}\n`
        transactionList += `   User: ${userInfo}\n`
        transactionList += `   ID: #${tx.id}\n`
        transactionList += `   Status: ${tx.status}\n\n`
      })

      transactionList += "Use /respond [transaction_id] to chat with a user."

      await ctx.reply(transactionList, { parse_mode: "Markdown" })
    } catch (error) {
      console.error("Error in list command:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Help command
  bot.command("help", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      let helpText = "🤖 **Crypto Exchange Bot Help**\n\n"
      helpText += "**Available Commands:**\n"
      helpText += "/start - Start the bot\n"
      helpText += "/help - Show this help message\n\n"
      helpText += "**Features:**\n"
      helpText += "💰 Buy cryptocurrencies\n"
      helpText += "💱 Sell cryptocurrencies\n"
      helpText += "📋 View available tokens\n"
      helpText += "📊 Check your transactions\n"
      helpText += "🔍 Search by contract address\n\n"

      if (isAdmin(userId)) {
        helpText += "**Admin Commands:**\n"
        helpText += "/respond [id] - Chat with user\n"
        helpText += "/end [id] - End conversation\n"
        helpText += "/list - Show active transactions\n\n"
      }

      helpText += "Need help? Contact our support team!"

      await ctx.reply(helpText, { parse_mode: "Markdown" })
    } catch (error) {
      console.error("Error in help command:", error)
      await ctx.reply("Sorry, there was an error. Please try again.")
    }
  })

  // Error handling
  bot.catch((err) => {
    console.error("Bot error:", err)
  })

  console.log("Bot initialized successfully with all features!")
}

// Call setup function
setupBot().catch((err) => {
  console.error("Error setting up bot:", err)
})

// Express routes
app.get("/", (req, res) => {
  res.json({
    status: "Crypto Trading Bot is running on Render",
    timestamp: new Date().toISOString(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    features: [
      "Buy/Sell Crypto",
      "Token Search",
      "Transaction Management",
      "Admin Chat System",
      "Contract Address Support",
    ],
  })
})

app.post("/webhook", async (req, res) => {
  try {
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
  console.log(`🚀 Crypto Trading Bot server running on port ${PORT}`)
  console.log("🤖 Bot is ready with full functionality!")
})
