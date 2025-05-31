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
  if (rep) return `${rep.name} (Customer Care)`

  return "Staff Member"
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
        "🤖 Welcome to Crypto Exchange Bot!\n\n" +
          "Your trusted platform for cryptocurrency trading.\n\n" +
          "What would you like to do today?",
        {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
              [{ text: "📋 Available Tokens" }, { text: "📊 My Orders" }],
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

      await ctx.reply(
        `💼 ${transactionType.toUpperCase()} CRYPTOCURRENCY\n\n` +
          `Please select the token you want to ${transactionType}:`,
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

  // My Orders
  bot.hears("📊 My Orders", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const userTransactions = Array.from(transactions.values())
        .filter((t) => t.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)

      if (userTransactions.length === 0) {
        await ctx.reply(
          "📊 YOUR ORDERS\n\n" + "You have no orders yet.\n\n" + "Start trading by selecting Buy or Sell!",
          {
            reply_markup: {
              keyboard: [[{ text: "🔙 Back to Menu" }]],
              resize_keyboard: true,
            },
          },
        )
        return
      }

      let orderList = "📊 YOUR RECENT ORDERS\n\n"

      userTransactions.forEach((tx, index) => {
        const statusEmoji =
          {
            pending: "⏳ Pending",
            in_progress: "🔄 Processing",
            completed: "✅ Completed",
            cancelled: "❌ Cancelled",
          }[tx.status] || "❓ Unknown"

        orderList += `${index + 1}. ${tx.type.toUpperCase()} ${tx.coin}\n`
        orderList += `   🆔 Order ID: #${tx.id}\n`
        orderList += `   📊 Status: ${statusEmoji}\n`
        orderList += `   📅 Date: ${new Date(tx.createdAt).toLocaleDateString()}\n\n`
      })

      await ctx.reply(orderList, {
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error showing orders:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Help & Support
  bot.hears("❓ Help & Support", async (ctx) => {
    try {
      const helpText =
        "❓ HELP & SUPPORT\n\n" +
        "How to use this bot:\n" +
        "1️⃣ Select Buy or Sell\n" +
        "2️⃣ Choose your cryptocurrency\n" +
        "3️⃣ Confirm your order\n" +
        "4️⃣ Chat with our support team\n\n" +
        "Available Commands:\n" +
        "• /start - Main menu\n" +
        "• /help - Show this help\n\n" +
        "Need assistance?\n" +
        "Our customer care team is available 24/7 to help you with your trades!\n\n" +
        "Security Notice:\n" +
        "Never share your private keys or wallet passwords with anyone!"

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

      await ctx.reply("🤖 Welcome back!\n\nWhat would you like to do?", {
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Orders" }],
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
          "Example:\n" +
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

      await ctx.reply(
        `💼 ${session.transactionType?.toUpperCase()} CRYPTOCURRENCY\n\n` +
          `Please select the token you want to ${session.transactionType}:`,
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
      session.contractAddress = selectedToken.contractAddress
      session.step = "confirm_order"
      userSessions.set(userId, session)

      const tokenInfo = getTokenDisplayInfo(selectedToken)

      await ctx.reply(
        `${tokenInfo}\n\n` +
          `📋 ORDER CONFIRMATION\n\n` +
          `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
          `🪙 Token: ${selectedToken.name}\n\n` +
          `Is this correct?`,
        {
          reply_markup: {
            keyboard: [[{ text: "✅ Confirm Order" }, { text: "❌ Cancel Order" }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )

      console.log(`📝 User ${getUserInfo(ctx)} selected token ${selectedToken.name}`)
    } catch (error) {
      console.error("Error in token selection:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Order confirmation
  bot.hears(["✅ Confirm Order", "❌ Cancel Order"], async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = userSessions.get(userId) || {}
      if (session.step !== "confirm_order") {
        await ctx.reply("Please start over with /start")
        return
      }

      if (ctx.message?.text === "❌ Cancel Order") {
        userSessions.set(userId, { step: "main_menu" })
        await ctx.reply("❌ Order Cancelled\n\nWhat would you like to do?", {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
              [{ text: "📋 Available Tokens" }, { text: "📊 My Orders" }],
              [{ text: "❓ Help & Support" }],
            ],
            resize_keyboard: true,
          },
        })
        return
      }

      // Create order
      const orderId = generateTransactionId()
      const order = {
        id: orderId,
        userId: userId,
        type: session.transactionType,
        coin: session.coin,
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

      await ctx.reply(
        `✅ ORDER CREATED SUCCESSFULLY!\n\n` +
          `🆔 Order ID: #${orderId}\n` +
          `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
          `🪙 Token: ${session.coin}\n` +
          `📊 Status: Pending\n\n` +
          `🎯 Next Steps:\n` +
          `Our customer care team will contact you shortly to process your order.\n\n` +
          `💬 You can send messages here and they will be forwarded to our support team.`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔄 New Order" }, { text: "📊 My Orders" }]],
            resize_keyboard: true,
          },
        },
      )

      // Notify all staff members
      const userInfo = getUserInfo(ctx)
      const tokenInfo = session.contractAddress ? `\n📍 Contract: ${session.contractAddress}` : ""

      const staffNotification =
        `🚨 NEW ORDER ALERT!\n\n` +
        `👤 Customer: ${userInfo}\n` +
        `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
        `🪙 Token: ${session.coin}${tokenInfo}\n` +
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
      console.error("Error in order confirmation:", error)
      await ctx.reply("❌ Sorry, there was an error processing your order. Please try again.")
    }
  })

  // New Order button
  bot.hears("🔄 New Order", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      userSessions.set(userId, { step: "main_menu" })

      await ctx.reply("🤖 Create New Order\n\nWhat would you like to do?", {
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Orders" }],
            [{ text: "❓ Help & Support" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
    } catch (error) {
      console.error("Error in new order:", error)
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

    let panelText = `👨‍💼 ADMIN PANEL\n\n`
    panelText += `👤 Welcome: ${staffInfo}\n`
    panelText += `📊 Pending Orders: ${pendingOrders}\n`
    panelText += `💬 Active Chats: ${activeChats}\n\n`
    panelText += `What would you like to do?`

    const keyboard = [[{ text: "📋 View Orders" }, { text: "💬 Active Chats" }]]

    if (isSuperAdmin(userId)) {
      keyboard.push([{ text: "👥 Manage Staff" }, { text: "📊 Statistics" }])
    }

    keyboard.push([{ text: "❓ Admin Help" }])

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
      const staffInfo = getStaffInfo(userId)

      await ctx.reply(
        `✅ ORDER ASSIGNED\n\n` +
          `🆔 Order ID: #${orderId}\n` +
          `👤 Customer: ${userInfo}\n` +
          `🔄 Action: ${order.type.toUpperCase()}\n` +
          `🪙 Token: ${order.coin}\n\n` +
          `💬 Chat Commands:\n` +
          `• Type messages to chat with customer\n` +
          `• /complete ${orderId} - Mark order as completed\n` +
          `• /cancel ${orderId} - Cancel the order\n\n` +
          `All your messages will be sent to the customer.`,
      )

      // Notify customer
      await bot.api.sendMessage(
        order.userId,
        `👨‍💼 SUPPORT CONNECTED\n\n` +
          `${staffInfo} has been assigned to your order #${orderId}\n\n` +
          `💬 You can now chat directly with our support team. All messages you send will be forwarded to them.`,
      )

      console.log(`📞 Order ${orderId} assigned to staff ${staffInfo}`)
    } catch (error) {
      console.error("Error in take command:", error)
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
        `✅ ORDER COMPLETED\n\n` +
          `Your order #${orderId} has been successfully completed!\n\n` +
          `Thank you for using our service. Type /start to create a new order.`,
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
        `❌ ORDER CANCELLED\n\n` +
          `Your order #${orderId} has been cancelled.\n\n` +
          `If you have any questions, please contact our support team. Type /start to create a new order.`,
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
            `You have been granted admin access to the Crypto Exchange Bot.\n\n` +
            `Type /start to access the admin panel.`,
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
        await ctx.reply("❌ Only admins can add customer care representatives.")
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

      await ctx.reply(`✅ ${repName} has been added as a customer care representative.`)

      // Notify new rep
      try {
        await bot.api.sendMessage(
          repId,
          `🎉 CUSTOMER CARE ACCESS GRANTED\n\n` +
            `You have been granted customer care access to the Crypto Exchange Bot.\n\n` +
            `Type /start to access the staff panel.`,
        )
      } catch (error) {
        console.log("Could not notify new rep (they may need to start the bot first)")
      }

      console.log(`👥 New customer care rep added: ${repName} (${repId})`)
    } catch (error) {
      console.error("Error adding customer care rep:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // ===========================================
  // MESSAGE HANDLING
  // ===========================================

  // Handle regular text messages
  bot.on("message:text", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const messageText = ctx.message?.text
      if (!messageText) return

      // Handle custom contract address input
      const session = userSessions.get(userId) || {}
      if (session.step === "custom_contract") {
        const contractAddress = messageText.trim()

        if (!isValidContractAddress(contractAddress)) {
          await ctx.reply(
            "❌ Invalid Contract Address\n\n" +
              "Please provide a valid Ethereum contract address.\n\n" +
              "Format: 0x followed by 40 hexadecimal characters\n" +
              "Example: 0x1234567890abcdef1234567890abcdef12345678",
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
          tokenInfo =
            `📋 Custom Token Information:\n` +
            `🏷️ Name: Unknown Token\n` +
            `🔤 Symbol: Unknown\n` +
            `📍 Contract: ${contractAddress}\n\n` +
            `⚠️ This is a custom token not in our predefined list.`
          tokenName = `Custom Token (${contractAddress.substring(0, 8)}...)`
        }

        session.coin = tokenName
        session.contractAddress = contractAddress
        session.step = "confirm_order"
        userSessions.set(userId, session)

        await ctx.reply(
          `${tokenInfo}\n\n` +
            `📋 ORDER CONFIRMATION\n\n` +
            `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
            `🪙 Token: ${tokenName}\n\n` +
            `Is this correct?`,
          {
            reply_markup: {
              keyboard: [[{ text: "✅ Confirm Order" }, { text: "❌ Cancel Order" }]],
              resize_keyboard: true,
              one_time_keyboard: true,
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

        if (chatSession.status === "waiting_for_staff") {
          await ctx.reply(
            "📤 Message Sent\n\n" +
              "Your message has been sent to our support team. Please wait for a response.\n\n" +
              "💡 Our team typically responds within a few minutes.",
          )
        } else if (chatSession.staffId) {
          // Forward to assigned staff
          const order = transactions.get(session.orderId)
          const userInfo = getUserInfo(ctx)

          await bot.api.sendMessage(
            chatSession.staffId,
            `💬 Customer Message (Order #${session.orderId})\n` +
              `👤 From: ${userInfo}\n\n` +
              `"${messageText}"\n\n` +
              `💡 Reply directly to respond to the customer.`,
          )

          await ctx.reply("📤 Message Sent\n\nYour message has been forwarded to our support team.")
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
            const staffInfo = getStaffInfo(userId)
            await bot.api.sendMessage(order.userId, `👨‍💼 ${staffInfo}:\n\n${messageText}`)

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

      // Default response for unrecognized messages
      await ctx.reply(
        "❓ I didn't understand that command.\n\n" +
          "Please use /start to access the main menu or use the buttons provided.",
      )
    } catch (error) {
      console.error("Error handling message:", error)
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

        ordersList += `${index + 1}. ${order.type.toUpperCase()} ${order.coin}\n`
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
        chatsList += `   🪙 Token: ${order?.coin || "Unknown"}\n`
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

  // Help command
  bot.command("help", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      if (canHandleCustomers(userId)) {
        let helpText = "👨‍💼 STAFF HELP\n\n"
        helpText += "Order Management:\n"
        helpText += "• /take [order_id] - Take an order\n"
        helpText += "• /complete [order_id] - Complete order\n"
        helpText += "• /cancel [order_id] - Cancel order\n\n"
        helpText += "Chat:\n"
        helpText += "• Type messages to chat with customers\n"
        helpText += "• Messages are automatically forwarded\n\n"

        if (isSuperAdmin(userId)) {
          helpText += "Super Admin:\n"
          helpText += "• /addadmin [user_id] [name] - Add admin\n"
          helpText += "• /addcare [user_id] [name] - Add customer care\n\n"
        } else if (isAdmin(userId)) {
          helpText += "Admin:\n"
          helpText += "• /addcare [user_id] [name] - Add customer care\n\n"
        }

        helpText += "Use /start to access the admin panel."

        await ctx.reply(helpText)
      } else {
        const helpText =
          "❓ HELP & SUPPORT\n\n" +
          "How to use this bot:\n" +
          "1️⃣ Select Buy or Sell\n" +
          "2️⃣ Choose your cryptocurrency\n" +
          "3️⃣ Confirm your order\n" +
          "4️⃣ Chat with our support team\n\n" +
          "Available Commands:\n" +
          "• /start - Main menu\n" +
          "• /help - Show this help\n\n" +
          "Need assistance?\n" +
          "Our customer care team is available 24/7!"

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

  console.log("✅ Crypto Trading Bot initialized successfully with all features!")
  console.log("👑 Super Admin IDs:", Array.from(SUPER_ADMIN_IDS))
}

// Initialize bot
setupBot().catch((err) => {
  console.error("❌ Error setting up bot:", err)
})

// Express routes
app.get("/", (req, res) => {
  res.json({
    status: "🤖 Crypto Trading Bot is running",
    timestamp: new Date().toISOString(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    features: [
      "✅ Buy/Sell Crypto Orders",
      "✅ Admin Panel System",
      "✅ Customer Care Management",
      "✅ Separate Chat Sessions",
      "✅ Order Tracking",
      "✅ Staff Management",
    ],
    stats: {
      totalOrders: transactions.size,
      activeChats: Array.from(chatSessions.values()).filter((c) => c.status === "active").length,
      totalAdmins: admins.size,
      totalCustomerCare: customerCareReps.size,
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
  console.log(`🚀 Crypto Trading Bot server running on port ${PORT}`)
  console.log("🤖 Bot is ready with complete admin system!")
  console.log("📊 Visit the URL to see bot statistics")
})
