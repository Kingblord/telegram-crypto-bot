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

// Storage
const userSessions = new Map()
const transactions = new Map()
const chatSessions = new Map()
const users = new Map()
const admins = new Map()
const customerCareReps = new Map()

// SUPER ADMIN IDs (Replace with your actual Telegram user ID from @userinfobot)
const SUPER_ADMIN_IDS = new Set(["7763673217"]) // Add your ID here

// Initialize with super admin
SUPER_ADMIN_IDS.forEach((id) => {
  admins.set(id, {
    id: id,
    role: "super_admin",
    name: "Super Admin",
    addedAt: new Date().toISOString(),
  })
})

// Create bot instance
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)

// Helper functions
function isValidContractAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

function isValidAmount(amount) {
  const num = Number.parseFloat(amount)
  return !isNaN(num) && num > 0
}

function isValidTxHash(hash) {
  return /^0x[a-fA-F0-9]{64}$/.test(hash)
}

function findTokenByContract(contractAddress) {
  return AVAILABLE_TOKENS.find((token) => token.contractAddress.toLowerCase() === contractAddress.toLowerCase())
}

function getTokenDisplayInfo(token) {
  return `📋 Token Information:
🏷️ Name: ${token.name}
🔤 Symbol: ${token.symbol}
📍 Contract: ${token.contractAddress}`
}

function generateTransactionId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 5)
}

function getUserInfo(ctx) {
  const user = ctx.from
  return user?.username ? `@${user.username}` : user?.first_name || "Unknown User"
}

function isSuperAdmin(userId) {
  return SUPER_ADMIN_IDS.has(userId.toString())
}

function isAdmin(userId) {
  return admins.has(userId.toString())
}

function isCustomerCare(userId) {
  return customerCareReps.has(userId.toString())
}

function canHandleCustomers(userId) {
  return isAdmin(userId.toString()) || isCustomerCare(userId.toString())
}

function getStaffInfo(userId) {
  const admin = admins.get(userId.toString())
  if (admin) return `${admin.name} (${admin.role})`

  const rep = customerCareReps.get(userId.toString())
  if (rep) return `${rep.name} (Shop Keeper)`

  return "Shop Keeper"
}

// Initialize bot
async function setupBot() {
  await bot.init()

  // ===========================================
  // USER COMMANDS
  // ===========================================

  // Start command
  bot.command("start", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      // Check if user is staff
      if (canHandleCustomers(userId)) {
        await showAdminPanel(ctx)
        return
      }

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

      await ctx.reply(
        "🏪 Welcome to Vintage & Crap Coin Store!\n\n" +
          "Your quirky shop for all things crypto - from vintage gems to the latest crap coins! 💎💩\n\n" +
          "🔥 Fast • Fun • Reliable\n\n" +
          "What would you like to do today?",
        {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
              [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
              [{ text: "❓ Help & Support" }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )

      userSessions.set(userId, { step: "main_menu" })
      console.log(`✅ User ${getUserInfo(ctx)} started the bot`)
    } catch (error) {
      console.error("Error in start command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Buy/Sell handlers
  bot.hears(["💰 Buy Crypto", "💱 Sell Crypto"], async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "main_menu") {
        await ctx.reply("Please start over with /start")
        return
      }

      const transactionType = ctx.message?.text?.includes("Buy") ? "buy" : "sell"
      session.transactionType = transactionType
      session.step = "select_token"
      userSessions.set(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Custom Token (Contract Address)" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      const actionText = transactionType === "buy" ? "purchase" : "sell"
      await ctx.reply(
        `💼 ${transactionType.toUpperCase()} CRYPTOCURRENCY\n\n` + `Select the token you want to ${actionText}:`,
        {
          reply_markup: {
            keyboard: tokenButtons,
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )

      console.log(`📝 User ${getUserInfo(ctx)} selected ${transactionType}`)
    } catch (error) {
      console.error("Error in transaction type selection:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Available Tokens
  bot.hears("📋 Available Tokens", async (ctx) => {
    try {
      let tokenList = "📋 AVAILABLE CRYPTOCURRENCIES\n\n"

      AVAILABLE_TOKENS.forEach((token, index) => {
        tokenList += `${index + 1}. ${token.name} (${token.symbol})\n`
        tokenList += `   📍 Contract: ${token.contractAddress}\n\n`
      })

      tokenList += "💡 You can also trade custom tokens using contract addresses!"

      await ctx.reply(tokenList, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error showing tokens:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // My Transactions
  bot.hears("📊 My Transactions", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const userTransactions = Array.from(transactions.values())
        .filter((t) => t.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)

      if (userTransactions.length === 0) {
        await ctx.reply(
          "📊 YOUR TRANSACTIONS\n\n" + "You have no transactions yet.\n\n" + "Start trading by selecting Buy or Sell!",
          {
            reply_markup: {
              keyboard: [[{ text: "🔙 Back to Menu" }]],
              resize_keyboard: true,
            },
          },
        )
        return
      }

      let transactionList = "📊 YOUR RECENT TRANSACTIONS\n\n"

      userTransactions.forEach((tx, index) => {
        const statusEmoji =
          {
            pending: "⏳ Processing",
            waiting_payment: "💳 Awaiting Payment",
            payment_sent: "🔄 Payment Verification",
            in_progress: "🔄 Processing",
            completed: "✅ Completed",
            cancelled: "❌ Cancelled",
          }[tx.status] || "❓ Unknown"

        transactionList += `${index + 1}. ${tx.type.toUpperCase()} ${tx.amount || ""} ${tx.coin}\n`
        transactionList += `   🆔 Transaction ID: #${tx.id}\n`
        transactionList += `   📊 Status: ${statusEmoji}\n`
        transactionList += `   📅 Date: ${new Date(tx.createdAt).toLocaleDateString()}\n\n`
      })

      await ctx.reply(transactionList, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error showing transactions:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Help & Support
  bot.hears("❓ Help & Support", async (ctx) => {
    try {
      const helpText =
        "❓ HELP & SUPPORT\n\n" +
        "🔹 How to Buy Crypto:\n" +
        "1️⃣ Select 'Buy Crypto'\n" +
        "2️⃣ Choose your token\n" +
        "3️⃣ Enter amount to buy\n" +
        "4️⃣ Make payment to provided address\n" +
        "5️⃣ Submit transaction hash\n" +
        "6️⃣ Receive your tokens\n\n" +
        "🔹 How to Sell Crypto:\n" +
        "1️⃣ Select 'Sell Crypto'\n" +
        "2️⃣ Choose your token\n" +
        "3️⃣ Enter amount to sell\n" +
        "4️⃣ Send tokens to provided address\n" +
        "5️⃣ Receive payment confirmation\n\n" +
        "🔹 Security:\n" +
        "• All transactions are verified on BSC\n" +
        "• Never share private keys\n" +
        "• Double-check all addresses\n\n" +
        "🔹 Support:\n" +
        "Our team is available 24/7 to assist you!"

      await ctx.reply(helpText, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error showing help:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Back to Menu
  bot.hears("🔙 Back to Menu", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      // Check if staff member
      if (canHandleCustomers(userId)) {
        await showAdminPanel(ctx)
        return
      }

      userSessions.set(userId, { step: "main_menu" })

      await ctx.reply("🏪 Welcome back to Vintage & Crap Coin Store!\n\nReady for more crypto adventures?", {
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
            [{ text: "❓ Help & Support" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error going back to menu:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Custom token search
  bot.hears("🔍 Custom Token (Contract Address)", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "select_token") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "custom_contract"
      userSessions.set(userId, session)

      await ctx.reply(
        "🔍 CUSTOM TOKEN SEARCH\n\n" +
          "Please send the contract address of the token you want to trade.\n\n" +
          "📝 Example:\n" +
          "0x1234567890abcdef1234567890abcdef12345678\n\n" +
          "⚠️ Make sure the address is correct!",
        {
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Token List" }]],
            resize_keyboard: true,
          },
        },
      )
    } catch (error) {
      console.error("Error in custom token search:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Back to token list
  bot.hears("🔙 Back to Token List", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "custom_contract") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "select_token"
      userSessions.set(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Custom Token (Contract Address)" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      const actionText = session.transactionType === "buy" ? "purchase" : "sell"
      await ctx.reply(
        `💼 ${session.transactionType?.toUpperCase()} CRYPTOCURRENCY\n\n` +
          `Select the token you want to ${actionText}:`,
        {
          reply_markup: {
            keyboard: tokenButtons,
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )
    } catch (error) {
      console.error("Error going back to token list:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Token selection from list
  bot.hears(/^[A-Z]+ - /, async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "select_token") return

      const selectedText = ctx.message?.text || ""
      const symbol = selectedText.split(" - ")[0]
      const selectedToken = AVAILABLE_TOKENS.find((token) => token.symbol === symbol)

      if (!selectedToken) {
        await ctx.reply("❌ Invalid token selection. Please try again.")
        return
      }

      session.coin = selectedToken.name
      session.symbol = selectedToken.symbol
      session.contractAddress = selectedToken.contractAddress
      session.step = "enter_amount"
      userSessions.set(userId, session)

      const tokenInfo = getTokenDisplayInfo(selectedToken)
      const actionText = session.transactionType === "buy" ? "purchase" : "sell"
      const amountText = session.transactionType === "buy" ? "How much USD worth" : "How many tokens"

      await ctx.reply(
        `${tokenInfo}\n\n` +
          `💰 AMOUNT ENTRY\n\n` +
          `${amountText} of ${selectedToken.symbol} would you like to ${actionText}?\n\n` +
          `📝 Please enter the amount:`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Token List" }]],
            resize_keyboard: true,
          },
        },
      )

      console.log(`📝 User ${getUserInfo(ctx)} selected token ${selectedToken.name}`)
    } catch (error) {
      console.error("Error in token selection:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Paid button handler
  bot.hears("✅ I Have Paid", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "payment_sent") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "enter_tx_hash"
      userSessions.set(userId, session)

      await ctx.reply(
        "📝 TRANSACTION HASH REQUIRED\n\n" +
          "Please provide your transaction hash for verification.\n\n" +
          "📋 Example:\n" +
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n\n" +
          "⚠️ Make sure the hash is correct!",
        {
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Menu" }]],
            resize_keyboard: true,
          },
        },
      )
    } catch (error) {
      console.error("Error in paid button:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // ===========================================
  // ADMIN PANEL FUNCTIONS
  // ===========================================

  async function showAdminPanel(ctx) {
    const userId = ctx.from?.id
    if (!userId) return

    const staffInfo = getStaffInfo(userId)
    const pendingOrders = Array.from(transactions.values()).filter((t) => t.status === "pending").length
    const activeChats = Array.from(chatSessions.values()).filter((c) => c.status === "active").length

    let panelText = `🏪 SHOP KEEPER PANEL\n\n`
    panelText += `👤 Welcome: ${staffInfo}\n`
    panelText += `📊 Pending Orders: ${pendingOrders}\n`
    panelText += `💬 Active Chats: ${activeChats}\n\n`
    panelText += `What would you like to do?`

    const keyboard = [[{ text: "📋 View Orders" }, { text: "💬 Active Chats" }]]

    if (isSuperAdmin(userId)) {
      keyboard.push([{ text: "👥 Manage Staff" }, { text: "📊 Statistics" }])
    }

    keyboard.push([{ text: "❓ CS Help" }])

    await ctx.reply(panelText, {
      reply_markup: {
        keyboard: keyboard,
        resize_keyboard: true,
      },
    })
  }

  // ===========================================
  // STAFF COMMANDS
  // ===========================================

  // Take order command
  bot.command("take", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) {
        await ctx.reply("❌ You are not authorized to use this command.")
        return
      }

      const orderId = ctx.match?.trim()
      if (!orderId) {
        await ctx.reply("❌ Please provide an order ID: /take [order_id]")
        return
      }

      const order = transactions.get(orderId)
      if (!order) {
        await ctx.reply("❌ Order not found.")
        return
      }

      if (order.status !== "pending") {
        await ctx.reply(`❌ Order #${orderId} is already being handled (Status: ${order.status})`)
        return
      }

      // Assign order to staff member
      order.status = "in_progress"
      order.assignedStaff = userId
      order.updatedAt = new Date().toISOString()
      transactions.set(orderId, order)

      // Update chat session
      const chatSession = chatSessions.get(orderId)
      if (chatSession) {
        chatSession.staffId = userId
        chatSession.status = "active"
        chatSessions.set(orderId, chatSession)
      }

      const user = users.get(order.userId)
      const userInfo = user?.username ? `@${user.username}` : user?.first_name || "Unknown"

      await ctx.reply(
        `✅ ORDER ASSIGNED\n\n` +
          `🆔 Order ID: #${orderId}\n` +
          `👤 Customer: ${userInfo}\n` +
          `🔄 Action: ${order.type.toUpperCase()}\n` +
          `🪙 Token: ${order.amount} ${order.symbol || order.coin}\n\n` +
          `💬 Available Commands:\n` +
          `• /wallet [order_id] [address] - Send wallet address\n` +
          `• /payment [order_id] [address] - Send payment address\n` +
          `• /send [order_id] [amount] [hash] - Send tokens with hash\n` +
          `• /complete [order_id] - Complete transaction\n` +
          `• /cancel [order_id] - Cancel transaction\n\n` +
          `Type messages to chat with customer.`,
      )

      // Notify customer
      await bot.api.sendMessage(
        order.userId,
        `🔄 PROCESSING UPDATE\n\n` +
          `Your ${order.type} request for ${order.amount} ${order.symbol || order.coin} is now being processed.\n\n` +
          `Our team will contact you shortly with the next steps.\n\n` +
          `💬 You can send messages here if you have any questions.`,
      )

      console.log(`📞 Order ${orderId} assigned to staff ${getStaffInfo(userId)}`)
    } catch (error) {
      console.error("Error in take command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Wallet command - Send wallet address to customer
  bot.command("wallet", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) {
        await ctx.reply("❌ You are not authorized to use this command.")
        return
      }

      const args = ctx.match?.trim().split(" ")
      if (!args || args.length < 2) {
        await ctx.reply("❌ Usage: /wallet [order_id] [wallet_address]")
        return
      }

      const orderId = args[0]
      const walletAddress = args[1]

      const order = transactions.get(orderId)
      if (!order) {
        await ctx.reply("❌ Order not found.")
        return
      }

      if (order.assignedStaff !== userId && !isSuperAdmin(userId)) {
        await ctx.reply("❌ You can only handle orders assigned to you.")
        return
      }

      // Update order status
      order.status = "waiting_payment"
      order.walletAddress = walletAddress
      order.updatedAt = new Date().toISOString()
      transactions.set(orderId, order)

      await ctx.reply(`✅ Wallet address sent to customer for order #${orderId}`)

      // Send wallet address to customer
      await bot.api.sendMessage(
        order.userId,
        `📍 WALLET ADDRESS PROVIDED\n\n` +
          `Please send your ${order.amount} ${order.symbol || order.coin} to the following address:\n\n` +
          `📋 Address: \`${walletAddress}\`\n\n` +
          `⚠️ IMPORTANT:\n` +
          `• Send ONLY ${order.symbol || order.coin} tokens\n` +
          `• Send exactly ${order.amount} tokens\n` +
          `• Double-check the address\n` +
          `• Use BSC network\n\n` +
          `After sending, please provide your transaction hash for verification.`,
        { parse_mode: "Markdown" },
      )

      console.log(`📍 Wallet address sent for order ${orderId}`)
    } catch (error) {
      console.error("Error in wallet command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Payment command - Send payment address to customer
  bot.command("payment", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) {
        await ctx.reply("❌ You are not authorized to use this command.")
        return
      }

      const args = ctx.match?.trim().split(" ")
      if (!args || args.length < 2) {
        await ctx.reply("❌ Usage: /payment [order_id] [payment_address]")
        return
      }

      const orderId = args[0]
      const paymentAddress = args[1]

      const order = transactions.get(orderId)
      if (!order) {
        await ctx.reply("❌ Order not found.")
        return
      }

      if (order.assignedStaff !== userId && !isSuperAdmin(userId)) {
        await ctx.reply("❌ You can only handle orders assigned to you.")
        return
      }

      // Update order status
      order.status = "waiting_payment"
      order.paymentAddress = paymentAddress
      order.updatedAt = new Date().toISOString()
      transactions.set(orderId, order)

      await ctx.reply(`✅ Payment address sent to customer for order #${orderId}`)

      // Send payment address to customer
      await bot.api.sendMessage(
        order.userId,
        `💳 PAYMENT ADDRESS PROVIDED\n\n` +
          `Please send your payment to the following address:\n\n` +
          `📋 Address: \`${paymentAddress}\`\n\n` +
          `💰 Amount: $${order.amount} USD worth of USDT/BUSD\n\n` +
          `⚠️ IMPORTANT:\n` +
          `• Send ONLY USDT or BUSD\n` +
          `• Send exactly $${order.amount} worth\n` +
          `• Use BSC network\n` +
          `• Double-check the address\n\n` +
          `After payment, click the button below and provide your transaction hash.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "✅ I Have Paid" }]],
            resize_keyboard: true,
          },
        },
      )

      console.log(`💳 Payment address sent for order ${orderId}`)
    } catch (error) {
      console.error("Error in payment command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Send command - Send tokens to customer with transaction hash
  bot.command("send", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) {
        await ctx.reply("❌ You are not authorized to use this command.")
        return
      }

      const args = ctx.match?.trim().split(" ")
      if (!args || args.length < 3) {
        await ctx.reply("❌ Usage: /send [order_id] [amount] [transaction_hash]")
        return
      }

      const orderId = args[0]
      const amount = args[1]
      const txHash = args[2]

      const order = transactions.get(orderId)
      if (!order) {
        await ctx.reply("❌ Order not found.")
        return
      }

      if (order.assignedStaff !== userId && !isSuperAdmin(userId)) {
        await ctx.reply("❌ You can only handle orders assigned to you.")
        return
      }

      // Update order
      order.sentAmount = amount
      order.sentTxHash = txHash
      order.updatedAt = new Date().toISOString()
      transactions.set(orderId, order)

      await ctx.reply(`✅ Tokens sent to customer for order #${orderId}`)

      // Notify customer
      await bot.api.sendMessage(
        order.userId,
        `🎉 TOKENS SENT!\n\n` +
          `We have sent ${amount} ${order.symbol || order.coin} to your wallet.\n\n` +
          `📋 Transaction Hash: \`${txHash}\`\n\n` +
          `✅ You can verify this transaction on BSCScan.\n\n` +
          `Thank you for using Vintage & Crap Coin Store!`,
        { parse_mode: "Markdown" },
      )

      console.log(`🎉 Tokens sent for order ${orderId}`)
    } catch (error) {
      console.error("Error in send command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Complete order command
  bot.command("complete", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) {
        await ctx.reply("❌ You are not authorized to use this command.")
        return
      }

      const orderId = ctx.match?.trim()
      if (!orderId) {
        await ctx.reply("❌ Please provide an order ID: /complete [order_id]")
        return
      }

      const order = transactions.get(orderId)
      if (!order) {
        await ctx.reply("❌ Order not found.")
        return
      }

      if (order.assignedStaff !== userId && !isSuperAdmin(userId)) {
        await ctx.reply("❌ You can only complete orders assigned to you.")
        return
      }

      // Complete order
      order.status = "completed"
      order.updatedAt = new Date().toISOString()
      transactions.set(orderId, order)

      // Update chat session
      const chatSession = chatSessions.get(orderId)
      if (chatSession) {
        chatSession.status = "completed"
        chatSessions.set(orderId, chatSession)
      }

      await ctx.reply(`✅ Order #${orderId} has been marked as completed.`)

      // Notify customer
      await bot.api.sendMessage(
        order.userId,
        `✅ TRANSACTION COMPLETED\n\n` +
          `Your ${order.type} transaction for ${order.amount} ${order.symbol || order.coin} has been successfully completed!\n\n` +
          `🎉 Thank you for shopping at Vintage & Crap Coin Store!\n\n` +
          `Type /start to make another transaction.`,
      )

      console.log(`✅ Order ${orderId} completed by staff ${getStaffInfo(userId)}`)
    } catch (error) {
      console.error("Error in complete command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Cancel order command
  bot.command("cancel", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) {
        await ctx.reply("❌ You are not authorized to use this command.")
        return
      }

      const orderId = ctx.match?.trim()
      if (!orderId) {
        await ctx.reply("❌ Please provide an order ID: /cancel [order_id]")
        return
      }

      const order = transactions.get(orderId)
      if (!order) {
        await ctx.reply("❌ Order not found.")
        return
      }

      if (order.assignedStaff !== userId && !isSuperAdmin(userId)) {
        await ctx.reply("❌ You can only cancel orders assigned to you.")
        return
      }

      // Cancel order
      order.status = "cancelled"
      order.updatedAt = new Date().toISOString()
      transactions.set(orderId, order)

      // Update chat session
      const chatSession = chatSessions.get(orderId)
      if (chatSession) {
        chatSession.status = "cancelled"
        chatSessions.set(orderId, chatSession)
      }

      await ctx.reply(`❌ Order #${orderId} has been cancelled.`)

      // Notify customer
      await bot.api.sendMessage(
        order.userId,
        `❌ TRANSACTION CANCELLED\n\n` +
          `Your transaction #${orderId} has been cancelled.\n\n` +
          `If you have any questions, please contact our support team.\n\n` +
          `Type /start to create a new transaction.`,
      )

      console.log(`❌ Order ${orderId} cancelled by staff ${getStaffInfo(userId)}`)
    } catch (error) {
      console.error("Error in cancel command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // ===========================================
  // SUPER ADMIN COMMANDS
  // ===========================================

  // Add admin command
  bot.command("addadmin", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isSuperAdmin(userId)) {
        await ctx.reply("❌ Only super admins can add new admins.")
        return
      }

      const args = ctx.match?.trim().split(" ")
      if (!args || args.length < 2) {
        await ctx.reply("❌ Usage: /addadmin [user_id] [name]")
        return
      }

      const newAdminId = args[0]
      const adminName = args.slice(1).join(" ")

      if (admins.has(newAdminId)) {
        await ctx.reply("❌ This user is already an admin.")
        return
      }

      admins.set(newAdminId, {
        id: newAdminId,
        role: "admin",
        name: adminName,
        addedBy: userId,
        addedAt: new Date().toISOString(),
      })

      await ctx.reply(`✅ ${adminName} has been added as an admin.`)

      // Notify new admin
      try {
        await bot.api.sendMessage(
          newAdminId,
          `🎉 ADMIN ACCESS GRANTED\n\n` +
            `You have been granted admin access to Vintage & Crap Coin Store.\n\n` +
            `Type /start to access the customer service panel.`,
        )
      } catch (error) {
        console.log("Could not notify new admin (they may need to start the bot first)")
      }

      console.log(`👑 New admin added: ${adminName} (${newAdminId})`)
    } catch (error) {
      console.error("Error adding admin:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Add customer care rep command
  bot.command("addcare", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isAdmin(userId)) {
        await ctx.reply("❌ Only admins can add customer service representatives.")
        return
      }

      const args = ctx.match?.trim().split(" ")
      if (!args || args.length < 2) {
        await ctx.reply("❌ Usage: /addcare [user_id] [name]")
        return
      }

      const repId = args[0]
      const repName = args.slice(1).join(" ")

      if (customerCareReps.has(repId) || admins.has(repId)) {
        await ctx.reply("❌ This user already has staff access.")
        return
      }

      customerCareReps.set(repId, {
        id: repId,
        name: repName,
        addedBy: userId,
        addedAt: new Date().toISOString(),
      })

      await ctx.reply(`✅ ${repName} has been added as a customer service representative.`)

      // Notify new rep
      try {
        await bot.api.sendMessage(
          repId,
          `🎉 CUSTOMER SERVICE ACCESS GRANTED\n\n` +
            `You have been granted shop keeper access to Vintage & Crap Coin Store.\n\n` +
            `Type /start to access the staff panel.`,
        )
      } catch (error) {
        console.log("Could not notify new rep (they may need to start the bot first)")
      }

      console.log(`👥 New customer service rep added: ${repName} (${repId})`)
    } catch (error) {
      console.error("Error adding customer service rep:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // ===========================================
  // MESSAGE HANDLING
  // ===========================================

  // Handle custom contract address input
  bot.on("message:text", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const messageText = ctx.message?.text
      if (!messageText) return

      const session = userSessions.get(userId) || {}

      // Only handle specific steps, let bot.hears() handle button presses
      if (session.step === "custom_contract") {
        const contractAddress = messageText.trim()

        if (!isValidContractAddress(contractAddress)) {
          await ctx.reply(
            "❌ Invalid Contract Address\n\n" +
              "Please provide a valid Ethereum contract address.\n\n" +
              "📝 Format: 0x followed by 40 hexadecimal characters\n\n" +
              "📝 Example: 0x1234567890abcdef1234567890abcdef12345678",
          )
          return
        }

        const knownToken = findTokenByContract(contractAddress)
        let tokenInfo
        let tokenName
        let tokenSymbol

        if (knownToken) {
          tokenInfo = getTokenDisplayInfo(knownToken)
          tokenName = knownToken.name
          tokenSymbol = knownToken.symbol
        } else {
          tokenInfo =
            `📋 Custom Token Information:\n\n` +
            `🏷️ Name: Unknown Token\n\n` +
            `🔤 Symbol: Unknown\n\n` +
            `📍 Contract: ${contractAddress}\n\n` +
            `⚠️ This is a custom token not in our predefined list.`
          tokenName = `Custom Token (${contractAddress.substring(0, 8)}...)`
          tokenSymbol = "CUSTOM"
        }

        session.coin = tokenName
        session.symbol = tokenSymbol
        session.contractAddress = contractAddress
        session.step = "enter_amount"
        userSessions.set(userId, session)

        const actionText = session.transactionType === "buy" ? "purchase" : "sell"
        const amountText = session.transactionType === "buy" ? "How much USD worth" : "How many tokens"

        await ctx.reply(
          `${tokenInfo}\n\n` +
            `💰 AMOUNT ENTRY\n\n` +
            `${amountText} of ${tokenSymbol} would you like to ${actionText}?\n\n` +
            `📝 Please enter the amount:`,
          {
            reply_markup: {
              keyboard: [[{ text: "🔙 Back to Token List" }]],
              resize_keyboard: true,
            },
          },
        )
        return
      }

      // Handle amount input
      if (session.step === "enter_amount") {
        const amount = messageText.trim()

        if (!isValidAmount(amount)) {
          await ctx.reply(
            "❌ Invalid Amount\n\n" + "Please enter a valid number greater than 0.\n\n" + "📝 Example: 100 or 50.5",
          )
          return
        }

        session.amount = amount
        session.step = "confirm_transaction"
        userSessions.set(userId, session)

        const actionText = session.transactionType === "buy" ? "purchase" : "sell"
        const amountDisplay = session.transactionType === "buy" ? `$${amount} USD worth of` : `${amount}`

        await ctx.reply(
          `📋 TRANSACTION CONFIRMATION\n\n` +
            `🔄 Action: ${session.transactionType?.toUpperCase()}\n\n` +
            `🪙 Token: ${session.symbol} (${session.coin})\n\n` +
            `💰 Amount: ${amountDisplay} ${session.symbol}\n\n` +
            `Is this correct?`,
          {
            reply_markup: {
              keyboard: [[{ text: "✅ Confirm Transaction" }, { text: "❌ Cancel Transaction" }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          },
        )
        return
      }

      // Handle transaction hash input
      if (session.step === "enter_tx_hash") {
        const txHash = messageText.trim()

        if (!isValidTxHash(txHash)) {
          await ctx.reply(
            "❌ Invalid Transaction Hash\n\n" +
              "Please provide a valid BSC transaction hash.\n\n" +
              "📝 Format: 0x followed by 64 hexadecimal characters\n\n" +
              "📝 Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          )
          return
        }

        // Update transaction with hash
        const order = transactions.get(session.orderId)
        if (order) {
          order.customerTxHash = txHash
          order.status = "payment_sent"
          order.updatedAt = new Date().toISOString()
          transactions.set(session.orderId, order)

          // Notify customer service
          if (order.assignedStaff) {
            await bot.api.sendMessage(
              order.assignedStaff,
              `💳 PAYMENT RECEIVED - Order #${session.orderId}\n\n` +
                `Customer has provided transaction hash:\n\n` +
                `📋 Hash: ${txHash}\n\n` +
                `Please verify on BSCScan and process the order.\n\n` +
                `Commands:\n\n` +
                `• /send ${session.orderId} [amount] [your_tx_hash] - Send tokens\n\n` +
                `• /complete ${session.orderId} - Complete transaction`,
            )
          }
        }

        session.step = "waiting_verification"
        userSessions.set(userId, session)

        await ctx.reply(
          "✅ TRANSACTION HASH RECEIVED\n\n" +
            "Thank you! We have received your transaction hash.\n\n" +
            "🔄 Our team is now verifying your payment on BSCScan.\n\n" +
            "⏱️ This usually takes 2-5 minutes.\n\n" +
            "We will notify you once verification is complete and your tokens are sent.",
          {
            reply_markup: {
              keyboard: [[{ text: "🔙 Back to Menu" }]],
              resize_keyboard: true,
            },
          },
        )
        return
      }

      // Handle customer chat messages
      if (session.step === "chat_with_support" && session.orderId) {
        const chatSession = chatSessions.get(session.orderId)
        if (!chatSession) {
          await ctx.reply("❌ Chat session not found. Please start over with /start")
          return
        }

        // Store message
        const message = {
          from: "customer",
          userId: userId,
          text: messageText,
          timestamp: new Date().toISOString(),
        }
        chatSession.messages.push(message)
        chatSessions.set(session.orderId, chatSession)

        if (chatSession.staffId) {
          // Forward to assigned staff
          const userInfo = getUserInfo(ctx)

          await bot.api.sendMessage(
            chatSession.staffId,
            `💬 Customer Message (Order #${session.orderId})\n\n` +
              `👤 From: ${userInfo}\n\n` +
              `"${messageText}"\n\n` +
              `💡 Reply directly to respond to the customer.`,
          )

          await ctx.reply("📤 Message sent to our support team.")
        } else {
          await ctx.reply("📤 Message received.\n\n" + "Our team will respond shortly. Please wait for assistance.")
        }

        console.log(`💬 Customer message in order ${session.orderId}: ${messageText}`)
        return
      }

      // Handle staff messages (when they're chatting with customers)
      if (canHandleCustomers(userId)) {
        // Find active chat sessions for this staff member
        const activeChats = Array.from(chatSessions.values()).filter(
          (chat) => chat.staffId === userId && chat.status === "active",
        )

        if (activeChats.length === 1) {
          const chatSession = activeChats[0]
          const order = transactions.get(chatSession.orderId)

          if (order) {
            // Store staff message
            const message = {
              from: "staff",
              userId: userId,
              text: messageText,
              timestamp: new Date().toISOString(),
            }
            chatSession.messages.push(message)
            chatSessions.set(chatSession.orderId, chatSession)

            // Forward to customer
            await bot.api.sendMessage(order.userId, `💬 Support Team:\n\n${messageText}`)

            await ctx.reply(`📤 Message sent to customer (Order #${chatSession.orderId})`)
            console.log(`💬 Staff message sent to customer in order ${chatSession.orderId}`)
            return
          }
        } else if (activeChats.length > 1) {
          await ctx.reply(
            "❌ You have multiple active chats. Please use /take [order_id] to specify which order you want to respond to.",
          )
          return
        }

        // If no active chats, show admin panel
        await showAdminPanel(ctx)
        return
      }

      // Only show "didn't understand" for unrecognized text input, not button presses
      console.log(`Unrecognized message: "${messageText}" from user ${userId}`)
    } catch (error) {
      console.error("Error handling message:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Transaction confirmation handlers
  bot.hears(["✅ Confirm Transaction", "❌ Cancel Transaction"], async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "confirm_transaction") {
        await ctx.reply("Please start over with /start")
        return
      }

      if (ctx.message?.text === "❌ Cancel Transaction") {
        userSessions.set(userId, { step: "main_menu" })
        await ctx.reply("❌ Transaction Cancelled\n\nWhat would you like to do?", {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
              [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
              [{ text: "❓ Help & Support" }],
            ],
            resize_keyboard: true,
          },
        })
        return
      }

      // Create transaction
      const orderId = generateTransactionId()
      const order = {
        id: orderId,
        userId: userId,
        type: session.transactionType,
        coin: session.coin,
        symbol: session.symbol,
        amount: session.amount,
        contractAddress: session.contractAddress,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedStaff: null,
      }

      transactions.set(orderId, order)

      // Create chat session
      chatSessions.set(orderId, {
        orderId: orderId,
        userId: userId,
        staffId: null,
        messages: [],
        status: "waiting_for_staff",
      })

      session.orderId = orderId
      session.step = "chat_with_support"
      userSessions.set(userId, session)

      const actionText = session.transactionType === "buy" ? "purchase" : "sell"
      const amountDisplay = session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`

      await ctx.reply(
        `✅ TRANSACTION CREATED\n\n` +
          `🆔 Transaction ID: #${orderId}\n\n` +
          `🔄 Action: ${session.transactionType?.toUpperCase()}\n\n` +
          `🪙 Token: ${session.symbol} (${session.coin})\n\n` +
          `💰 Amount: ${amountDisplay} ${session.symbol}\n\n` +
          `🔄 Your order is brewing in our vintage shop!\n\n` +
          `📋 You've been added to our queue and will be notified.\n\n` +
          `⏱️ Processing time: 2-10 minutes\n\n` +
          `💬 Got questions? Chat with our shop keepers anytime!`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔄 New Transaction" }, { text: "📊 My Transactions" }]],
            resize_keyboard: true,
          },
        },
      )

      // Notify staff members
      const userInfo = getUserInfo(ctx)
      const tokenInfo = session.contractAddress ? `\n📍 Contract: ${session.contractAddress}` : ""

      const staffNotification =
        `🚨 NEW ${session.transactionType?.toUpperCase()} ORDER!\n\n` +
        `👤 Customer: ${userInfo}\n\n` +
        `🪙 Token: ${session.symbol} (${session.coin})\n\n` +
        `💰 Amount: ${amountDisplay} ${session.symbol}${tokenInfo}\n\n` +
        `🆔 Order ID: #${orderId}\n\n` +
        `💼 Use /take ${orderId} to handle this order`

      // Notify admins
      for (const [adminId, admin] of admins) {
        try {
          await bot.api.sendMessage(adminId, staffNotification)
        } catch (error) {
          console.error(`Error notifying admin ${adminId}:`, error)
        }
      }

      // Notify customer care reps
      for (const [repId, rep] of customerCareReps) {
        try {
          await bot.api.sendMessage(repId, staffNotification)
        } catch (error) {
          console.error(`Error notifying rep ${repId}:`, error)
        }
      }

      console.log(`✅ Order ${orderId} created for user ${getUserInfo(ctx)}`)
    } catch (error) {
      console.error("Error in transaction confirmation:", error)
      await ctx.reply("❌ Sorry, there was an error processing your transaction. Please try again.")
    }
  })

  // New Transaction button
  bot.hears("🔄 New Transaction", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      userSessions.set(userId, { step: "main_menu" })

      await ctx.reply("🏪 Browse Our Coin Collection\n\nWhat would you like to do?", {
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
            [{ text: "❓ Help & Support" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error in new transaction:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // ===========================================
  // ADMIN PANEL HANDLERS
  // ===========================================

  // View Orders
  bot.hears("📋 View Orders", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) return

      const pendingOrders = Array.from(transactions.values())
        .filter((t) => t.status === "pending")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)

      if (pendingOrders.length === 0) {
        await ctx.reply(
          "📋 PENDING ORDERS\n\n" +
            "No pending orders at the moment.\n\n" +
            "New orders will appear here automatically.",
          {
            reply_markup: {
              keyboard: [[{ text: "🔙 Back to Panel" }]],
              resize_keyboard: true,
            },
          },
        )
        return
      }

      let ordersList = "📋 PENDING ORDERS\n\n"

      pendingOrders.forEach((order, index) => {
        const user = users.get(order.userId)
        const userInfo = user?.username ? `@${user.username}` : user?.first_name || "Unknown"
        const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`

        ordersList += `${index + 1}. ${order.type.toUpperCase()} ${amountDisplay} ${order.symbol}\n`
        ordersList += `   👤 Customer: ${userInfo}\n`
        ordersList += `   🆔 Order ID: #${order.id}\n`
        ordersList += `   📅 Created: ${new Date(order.createdAt).toLocaleString()}\n`
        ordersList += `   💼 Use: /take ${order.id}\n\n`
      })

      await ctx.reply(ordersList, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Panel" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error viewing orders:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Active Chats
  bot.hears("💬 Active Chats", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) return

      const activeChats = Array.from(chatSessions.values())
        .filter((chat) => chat.status === "active")
        .sort(
          (a, b) =>
            new Date(b.messages[b.messages.length - 1]?.timestamp || 0) -
            new Date(a.messages[a.messages.length - 1]?.timestamp || 0),
        )

      if (activeChats.length === 0) {
        await ctx.reply(
          "💬 ACTIVE CHATS\n\n" + "No active chats at the moment.\n\n" + "Active conversations will appear here.",
          {
            reply_markup: {
              keyboard: [[{ text: "🔙 Back to Panel" }]],
              resize_keyboard: true,
            },
          },
        )
        return
      }

      let chatsList = "💬 ACTIVE CHATS\n\n"

      activeChats.forEach((chat, index) => {
        const order = transactions.get(chat.orderId)
        const user = users.get(chat.userId)
        const staff = getStaffInfo(chat.staffId)
        const userInfo = user?.username ? `@${user.username}` : user?.first_name || "Unknown"

        chatsList += `${index + 1}. Order #${chat.orderId}\n`
        chatsList += `   👤 Customer: ${userInfo}\n`
        chatsList += `   👨‍💼 Staff: ${staff}\n`
        chatsList += `   🪙 Token: ${order?.amount} ${order?.symbol || order?.coin || "Unknown"}\n`
        chatsList += `   💬 Messages: ${chat.messages.length}\n\n`
      })

      await ctx.reply(chatsList, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Panel" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error viewing chats:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Back to Panel
  bot.hears("🔙 Back to Panel", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) return

      await showAdminPanel(ctx)
    } catch (error) {
      console.error("Error going back to panel:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Manage Staff (Super Admin only)
  bot.hears("👥 Manage Staff", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isSuperAdmin(userId)) {
        await ctx.reply("❌ Only super admins can manage staff.")
        return
      }

      let staffList = "👥 STAFF MANAGEMENT\n\n"

      // List all admins
      if (admins.size > 0) {
        staffList += "👑 ADMINS:\n"
        for (const [adminId, admin] of admins) {
          staffList += `• ${admin.name} (${admin.role}) - ID: ${adminId}\n`
        }
        staffList += "\n"
      }

      // List all customer care reps
      if (customerCareReps.size > 0) {
        staffList += "👥 CUSTOMER SERVICE:\n"
        for (const [repId, rep] of customerCareReps) {
          staffList += `• ${rep.name} - ID: ${repId}\n`
        }
        staffList += "\n"
      }

      staffList += "Commands:\n"
      staffList += "• /addadmin [user_id] [name] - Add new admin\n"
      staffList += "• /addcare [user_id] [name] - Add customer service rep\n"
      staffList += "• /removestaff [user_id] - Remove staff member"

      await ctx.reply(staffList, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Panel" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error in manage staff:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Statistics (Super Admin only)
  bot.hears("📊 Statistics", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isSuperAdmin(userId)) {
        await ctx.reply("❌ Only super admins can view statistics.")
        return
      }

      const totalUsers = users.size
      const totalTransactions = transactions.size
      const pendingOrders = Array.from(transactions.values()).filter((t) => t.status === "pending").length
      const completedOrders = Array.from(transactions.values()).filter((t) => t.status === "completed").length
      const cancelledOrders = Array.from(transactions.values()).filter((t) => t.status === "cancelled").length
      const activeChats = Array.from(chatSessions.values()).filter((c) => c.status === "active").length
      const totalAdmins = admins.size
      const totalCustomerCare = customerCareReps.size

      // Get today's transactions
      const today = new Date().toDateString()
      const todayTransactions = Array.from(transactions.values()).filter(
        (t) => new Date(t.createdAt).toDateString() === today,
      ).length

      let statsText = "📊 VINTAGE & CRAP COIN STORE STATISTICS\n\n"
      statsText += "👥 USERS & STAFF:\n"
      statsText += `• Total Users: ${totalUsers}\n`
      statsText += `• Total Admins: ${totalAdmins}\n`
      statsText += `• Customer Service Reps: ${totalCustomerCare}\n\n`

      statsText += "📋 TRANSACTIONS:\n"
      statsText += `• Total Transactions: ${totalTransactions}\n`
      statsText += `• Today's Transactions: ${todayTransactions}\n`
      statsText += `• Pending: ${pendingOrders}\n`
      statsText += `• Completed: ${completedOrders}\n`
      statsText += `• Cancelled: ${cancelledOrders}\n\n`

      statsText += "💬 CHATS:\n"
      statsText += `• Active Chats: ${activeChats}\n`
      statsText += `• Total Chat Sessions: ${chatSessions.size}\n\n`

      statsText += `📅 Last Updated: ${new Date().toLocaleString()}`

      await ctx.reply(statsText, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Panel" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error in statistics:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // CS Help
  bot.hears("❓ CS Help", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !canHandleCustomers(userId)) return

      let helpText = "❓ CUSTOMER SERVICE HELP\n\n"

      helpText += "📋 ORDER MANAGEMENT:\n"
      helpText += "• /take [order_id] - Take control of an order\n"
      helpText += "• /wallet [order_id] [address] - Send wallet address (for sells)\n"
      helpText += "• /payment [order_id] [address] - Send payment address (for buys)\n"
      helpText += "• /send [order_id] [amount] [hash] - Send tokens with tx hash\n"
      helpText += "• /complete [order_id] - Complete transaction\n"
      helpText += "• /cancel [order_id] - Cancel transaction\n\n"

      helpText += "💬 CHAT SYSTEM:\n"
      helpText += "• Type messages to chat with customers\n"
      helpText += "• Messages are automatically forwarded\n"
      helpText += "• Only one active chat per staff member\n\n"

      helpText += "🔄 WORKFLOW:\n"
      helpText += "BUY Orders:\n"
      helpText += "1. /take [order_id]\n"
      helpText += "2. /payment [order_id] [payment_address]\n"
      helpText += "3. Customer pays and provides tx hash\n"
      helpText += "4. Verify payment on BSCScan\n"
      helpText += "5. /send [order_id] [amount] [your_tx_hash]\n"
      helpText += "6. /complete [order_id]\n\n"

      helpText += "SELL Orders:\n"
      helpText += "1. /take [order_id]\n"
      helpText += "2. /wallet [order_id] [receiving_address]\n"
      helpText += "3. Customer sends tokens and provides tx hash\n"
      helpText += "4. Verify tokens received on BSCScan\n"
      helpText += "5. Send payment to customer\n"
      helpText += "6. /complete [order_id]\n\n"

      if (isSuperAdmin(userId)) {
        helpText += "👑 SUPER ADMIN COMMANDS:\n"
        helpText += "• /addadmin [user_id] [name] - Add new admin\n"
        helpText += "• /addcare [user_id] [name] - Add customer service rep\n"
        helpText += "• /removestaff [user_id] - Remove staff member\n"
        helpText += "• Manage Staff - View all staff members\n"
        helpText += "• Statistics - View bot statistics\n"
      } else if (isAdmin(userId)) {
        helpText += "👨‍💼 ADMIN COMMANDS:\n"
        helpText += "• /addcare [user_id] [name] - Add customer service rep\n"
      }

      helpText += "\n💡 TIPS:\n"
      helpText += "• Use /start to return to CS panel\n"
      helpText += "• Get user IDs from @userinfobot\n"
      helpText += "• Always verify transactions on BSCScan\n"
      helpText += "• Complete or cancel orders when done"

      await ctx.reply(helpText, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Panel" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error in CS help:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Remove staff command (Super Admin only)
  bot.command("removestaff", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isSuperAdmin(userId)) {
        await ctx.reply("❌ Only super admins can remove staff members.")
        return
      }

      const staffId = ctx.match?.trim()
      if (!staffId) {
        await ctx.reply("❌ Please provide a user ID: /removestaff [user_id]")
        return
      }

      // Check if user is an admin
      if (admins.has(staffId)) {
        const admin = admins.get(staffId)
        if (admin.role === "super_admin") {
          await ctx.reply("❌ Cannot remove super admin.")
          return
        }
        admins.delete(staffId)
        await ctx.reply(`✅ Admin ${admin.name} has been removed.`)

        // Notify removed admin
        try {
          await bot.api.sendMessage(staffId, "❌ Your admin access has been revoked.")
        } catch (error) {
          console.log("Could not notify removed admin")
        }

        console.log(`❌ Admin removed: ${admin.name} (${staffId})`)
        return
      }

      // Check if user is customer care
      if (customerCareReps.has(staffId)) {
        const rep = customerCareReps.get(staffId)
        customerCareReps.delete(staffId)
        await ctx.reply(`✅ Customer service representative ${rep.name} has been removed.`)

        // Notify removed rep
        try {
          await bot.api.sendMessage(staffId, "❌ Your customer service access has been revoked.")
        } catch (error) {
          console.log("Could not notify removed rep")
        }

        console.log(`❌ Customer service rep removed: ${rep.name} (${staffId})`)
        return
      }

      await ctx.reply("❌ User not found in staff list.")
    } catch (error) {
      console.error("Error removing staff:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Help command
  bot.command("help", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      if (canHandleCustomers(userId)) {
        let helpText = "👨‍💼 CUSTOMER SERVICE HELP\n\n"
        helpText += "Order Management:\n"
        helpText += "• /take [order_id] - Take an order\n"
        helpText += "• /wallet [order_id] [address] - Send wallet address\n"
        helpText += "• /payment [order_id] [address] - Send payment address\n"
        helpText += "• /send [order_id] [amount] [hash] - Send tokens\n"
        helpText += "• /complete [order_id] - Complete order\n"
        helpText += "• /cancel [order_id] - Cancel order\n\n"

        if (isSuperAdmin(userId)) {
          helpText += "Super Admin:\n"
          helpText += "• /addadmin [user_id] [name] - Add admin\n"
          helpText += "• /addcare [user_id] [name] - Add customer service\n\n"
        } else if (isAdmin(userId)) {
          helpText += "Admin:\n"
          helpText += "• /addcare [user_id] [name] - Add customer service\n\n"
        }

        helpText += "Use /start to access the CS panel."

        await ctx.reply(helpText)
      } else {
        const helpText =
          "❓ HELP & SUPPORT\n\n" +
          "How to shop at Vintage & Crap Coin Store:\n" +
          "1️⃣ Select Buy or Sell\n" +
          "2️⃣ Choose your cryptocurrency\n" +
          "3️⃣ Enter the amount\n" +
          "4️⃣ Confirm your transaction\n" +
          "5️⃣ Follow payment instructions\n\n" +
          "Available Commands:\n" +
          "• /start - Main menu\n" +
          "• /help - Show this help\n\n" +
          "Need assistance?\n" +
          "Our customer service team is available 24/7!"

        await ctx.reply(helpText)
      }
    } catch (error) {
      console.error("Error in help command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Error handling
  bot.catch((err) => {
    console.error("❌ Bot error:", err)
  })

  console.log("✅ Vintage & Crap Coin Store Bot initialized successfully!")
  console.log("👑 Super Admin IDs:", Array.from(SUPER_ADMIN_IDS))
}

// Initialize bot
setupBot().catch((err) => {
  console.error("❌ Error setting up bot:", err)
})

// Express routes
app.get("/", (req, res) => {
  res.json({
    status: "🏪 Vintage & Crap Coin Store is running",
    timestamp: new Date().toISOString(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    features: [
      "✅ Buy/Sell Crypto with Amount Entry",
      "✅ Professional Customer Service System",
      "✅ BSC Transaction Verification",
      "✅ Wallet & Payment Address Management",
      "✅ Transaction Hash Tracking",
      "✅ Real-time Chat Support",
    ],
    stats: {
      totalTransactions: transactions.size,
      activeChats: Array.from(chatSessions.values()).filter((c) => c.status === "active").length,
      totalAdmins: admins.size,
      totalCustomerService: customerCareReps.size,
    },
  })
})

app.post("/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body)
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("❌ Webhook error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 Vintage & Crap Coin Store server running on port ${PORT}`)
  console.log("🏪 Vintage & Crap Coin Store is ready for business!")
  console.log("📊 Visit the URL to see bot statistics")
})
