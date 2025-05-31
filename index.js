const express = require("express")
const { Bot } = require("grammy")
const admin = require("firebase-admin")

const app = express()
app.use(express.json())

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  })
}

const db = admin.firestore()

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

// SUPER ADMIN IDs (Replace with your actual Telegram user ID from @userinfobot)
const SUPER_ADMIN_IDS = new Set(["7763673217"]) // Add your ID here

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

// Firestore helper functions
async function isAdmin(userId) {
  try {
    const adminDoc = await db.collection("admins").doc(userId.toString()).get()
    return adminDoc.exists
  } catch (error) {
    console.error("Error checking admin status:", error)
    return false
  }
}

async function isCustomerCare(userId) {
  try {
    const careDoc = await db.collection("customerCare").doc(userId.toString()).get()
    return careDoc.exists
  } catch (error) {
    console.error("Error checking customer care status:", error)
    return false
  }
}

async function canHandleCustomers(userId) {
  const adminStatus = await isAdmin(userId)
  const careStatus = await isCustomerCare(userId)
  return adminStatus || careStatus
}

async function getStaffInfo(userId) {
  try {
    const adminDoc = await db.collection("admins").doc(userId.toString()).get()
    if (adminDoc.exists) {
      const admin = adminDoc.data()
      return `${admin.name} (${admin.role})`
    }

    const careDoc = await db.collection("customerCare").doc(userId.toString()).get()
    if (careDoc.exists) {
      const care = careDoc.data()
      return `${care.name} (Shop Keeper)`
    }

    return "Shop Keeper"
  } catch (error) {
    console.error("Error getting staff info:", error)
    return "Shop Keeper"
  }
}

async function getUserSession(userId) {
  try {
    const sessionDoc = await db.collection("sessions").doc(userId.toString()).get()
    if (sessionDoc.exists) {
      return sessionDoc.data()
    }
    return { step: "start" }
  } catch (error) {
    console.error("Error getting user session:", error)
    return { step: "start" }
  }
}

async function setUserSession(userId, session) {
  try {
    await db
      .collection("sessions")
      .doc(userId.toString())
      .set(
        {
          ...session,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
  } catch (error) {
    console.error("Error setting user session:", error)
  }
}

// Initialize super admins in Firestore
async function initializeSuperAdmins() {
  try {
    for (const adminId of SUPER_ADMIN_IDS) {
      await db.collection("admins").doc(adminId).set(
        {
          id: adminId,
          role: "super_admin",
          name: "Super Admin",
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }
    console.log("✅ Super admins initialized in Firestore")
  } catch (error) {
    console.error("Error initializing super admins:", error)
  }
}

// Initialize bot
async function setupBot() {
  await bot.init()
  await initializeSuperAdmins()

  // ===========================================
  // SPECIFIC BUTTON HANDLERS (MUST COME FIRST)
  // ===========================================

  // Transaction confirmation handlers - MUST BE FIRST
  bot.hears("✅ Confirm Transaction", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (session.step !== "confirm_transaction") {
        await ctx.reply("Please start over with /start")
        return
      }

      // Create transaction in Firestore
      const orderId = generateTransactionId()
      const orderData = {
        id: orderId,
        userId: userId,
        type: session.transactionType,
        coin: session.coin,
        symbol: session.symbol,
        amount: session.amount,
        contractAddress: session.contractAddress,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        assignedStaff: null,
      }

      await db.collection("transactions").doc(orderId).set(orderData)

      // Create chat session in Firestore
      await db.collection("chatSessions").doc(orderId).set({
        orderId: orderId,
        userId: userId,
        staffId: null,
        status: "waiting_for_staff",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      // Update user session
      session.orderId = orderId
      session.step = "chat_with_support"
      await setUserSession(userId, session)

      const amountDisplay = session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`

      await ctx.reply(
        `✅ TRANSACTION CREATED\n\n` +
          `🆔 Transaction ID: #${orderId}\n` +
          `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
          `🪙 Token: ${session.symbol} (${session.coin})\n` +
          `💰 Amount: ${amountDisplay} ${session.symbol}\n\n` +
          `🔄 Your order is brewing in our vintage shop!\n` +
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
        `👤 Customer: ${userInfo}\n` +
        `🪙 Token: ${session.symbol} (${session.coin})\n` +
        `💰 Amount: ${amountDisplay} ${session.symbol}${tokenInfo}\n` +
        `🆔 Order ID: #${orderId}\n\n` +
        `💼 Use /take ${orderId} to handle this order`

      // Notify all admins
      const adminsSnapshot = await db.collection("admins").get()
      for (const adminDoc of adminsSnapshot.docs) {
        try {
          await bot.api.sendMessage(adminDoc.id, staffNotification)
        } catch (error) {
          console.error(`Error notifying admin ${adminDoc.id}:`, error)
        }
      }

      // Notify all customer care reps
      const careSnapshot = await db.collection("customerCare").get()
      for (const careDoc of careSnapshot.docs) {
        try {
          await bot.api.sendMessage(careDoc.id, staffNotification)
        } catch (error) {
          console.error(`Error notifying care rep ${careDoc.id}:`, error)
        }
      }

      console.log(`✅ Order ${orderId} created for user ${getUserInfo(ctx)}`)
    } catch (error) {
      console.error("Error in transaction confirmation:", error)
      await ctx.reply("❌ Sorry, there was an error processing your transaction. Please try again.")
    }
  })

  bot.hears("❌ Cancel Transaction", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      await setUserSession(userId, { step: "main_menu" })
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
    } catch (error) {
      console.error("Error in cancel transaction:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Admin Panel Handlers
  bot.hears("📋 View Orders", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      console.log(`Admin ${userId} clicked View Orders`)

      const ordersSnapshot = await db
        .collection("transactions")
        .where("status", "==", "pending")
        .orderBy("createdAt", "desc")
        .limit(10)
        .get()

      if (ordersSnapshot.empty) {
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

      ordersSnapshot.docs.forEach((doc, index) => {
        const order = doc.data()
        const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`

        ordersList += `${index + 1}. ${order.type.toUpperCase()} ${amountDisplay} ${order.symbol}\n`
        ordersList += `   🆔 Order ID: #${order.id}\n`
        ordersList += `   📅 Created: ${order.createdAt?.toDate?.()?.toLocaleString() || "Just now"}\n`
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

  bot.hears("💬 Active Chats", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      console.log(`Admin ${userId} clicked Active Chats`)

      // Fetch active chats from Firestore (replace with your actual Firestore logic)
      // const activeChats = await getActiveChatsFromFirestore(); // Implement this function

      // if (activeChats.length === 0) {
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
      // }

      // let chatsList = "💬 ACTIVE CHATS\n\n";

      // activeChats.forEach((chat, index) => {
      //   const order = transactions.get(chat.orderId);
      //   const user = users.get(chat.userId);
      //   const staff = getStaffInfo(chat.staffId);
      //   const userInfo = user?.username ? `@${user.username}` : user?.first_name || "Unknown";

      //   chatsList += `${index + 1}. Order #${chat.orderId}\n`;
      //   chatsList += `   👤 Customer: ${userInfo}\n`;
      //   chatsList += `   👨‍💼 Staff: ${staff}\n`;
      //   chatsList += `   🪙 Token: ${order?.amount} ${order?.symbol || order?.coin || "Unknown"}\n`;
      //   chatsList += `   💬 Messages: ${chat.messages.length}\n\n`;
      // });

      // await ctx.reply(chatsList, {
      //   reply_markup: {
      //     keyboard: [[{ text: "🔙 Back to Panel" }]],
      //     resize_keyboard: true,
      //   },
      // });
    } catch (error) {
      console.error("Error viewing chats:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  bot.hears("👥 Manage Staff", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isSuperAdmin(userId)) {
        await ctx.reply("❌ Only super admins can manage staff.")
        return
      }

      console.log(`Super Admin ${userId} clicked Manage Staff`)

      let staffList = "👥 STAFF MANAGEMENT\n\n"

      // List all admins
      // if (admins.size > 0) {
      //   staffList += "👑 ADMINS:\n"
      //   for (const [adminId, admin] of admins) {
      //     staffList += `• ${admin.name} (${admin.role}) - ID: ${adminId}\n`
      //   }
      //   staffList += "\n"
      // }

      // List all customer care reps
      // if (customerCareReps.size > 0) {
      //   staffList += "👥 CUSTOMER SERVICE:\n"
      //   for (const [repId, rep] of customerCareReps) {
      //     staffList += `• ${rep.name} - ID: ${repId}\n`
      //   }
      //   staffList += "\n"
      // }

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

  bot.hears("📊 Statistics", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !isSuperAdmin(userId)) {
        await ctx.reply("❌ Only super admins can view statistics.")
        return
      }

      console.log(`Super Admin ${userId} clicked Statistics`)

      // const totalUsers = users.size
      // const totalTransactions = transactions.size
      // const pendingOrders = Array.from(transactions.values()).filter((t) => t.status === "pending").length
      // const completedOrders = Array.from(transactions.values()).filter((t) => t.status === "completed").length
      // const cancelledOrders = Array.from(transactions.values()).filter((t) => t.status === "cancelled").length
      // const activeChats = Array.from(chatSessions.values()).filter((c) => c.status === "active").length
      // const totalAdmins = admins.size
      // const totalCustomerCare = customerCareReps.size

      // Get today's transactions
      // const today = new Date().toDateString()
      // const todayTransactions = Array.from(transactions.values()).filter(
      //   (t) => new Date(t.createdAt).toDateString() === today,
      // ).length

      let statsText = "📊 VINTAGE & CRAP COIN STORE STATISTICS\n\n"
      statsText += "👥 USERS & STAFF:\n"
      statsText += `• Total Users: 0\n`
      statsText += `• Total Admins: 0\n`
      statsText += `• Customer Service Reps: 0\n\n`

      statsText += "📋 TRANSACTIONS:\n"
      statsText += `• Total Transactions: 0\n`
      statsText += `• Today's Transactions: 0\n`
      statsText += `• Pending: 0\n`
      statsText += `• Completed: 0\n`
      statsText += `• Cancelled: 0\n\n`

      statsText += "💬 CHATS:\n"
      statsText += `• Active Chats: 0\n`
      statsText += `• Total Chat Sessions: 0\n\n`

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

  bot.hears("❓ CS Help", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      console.log(`Staff ${userId} clicked CS Help`)

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
      } else if (await isAdmin(userId)) {
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

  bot.hears("🔙 Back to Panel", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      console.log(`Staff ${userId} clicked Back to Panel`)
      await showAdminPanel(ctx)
    } catch (error) {
      console.error("Error going back to panel:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // User button handlers
  bot.hears("💰 Buy Crypto", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (session.step !== "main_menu") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.transactionType = "buy"
      session.step = "select_token"
      await setUserSession(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Custom Token (Contract Address)" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      await ctx.reply(`💼 BUY CRYPTOCURRENCY\n\n` + `Select the token you want to purchase:`, {
        reply_markup: {
          keyboard: tokenButtons,
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })

      console.log(`📝 User ${getUserInfo(ctx)} selected buy`)
    } catch (error) {
      console.error("Error in buy crypto:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  bot.hears("💱 Sell Crypto", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (session.step !== "main_menu") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.transactionType = "sell"
      session.step = "select_token"
      await setUserSession(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Custom Token (Contract Address)" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      await ctx.reply(`💼 SELL CRYPTOCURRENCY\n\n` + `Select the token you want to sell:`, {
        reply_markup: {
          keyboard: tokenButtons,
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })

      console.log(`📝 User ${getUserInfo(ctx)} selected sell`)
    } catch (error) {
      console.error("Error in sell crypto:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Token selection from list
  bot.hears(/^[A-Z]+ - /, async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
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
      await setUserSession(userId, session)

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

  // Other user handlers...
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

  bot.hears("📊 My Transactions", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      // const userTransactions = Array.from(transactions.values())
      //   .filter((t) => t.userId === userId)
      //   .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      //   .slice(0, 10)

      // if (userTransactions.length === 0) {
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
      // }

      // let transactionList = "📊 YOUR RECENT TRANSACTIONS\n\n"

      // userTransactions.forEach((tx, index) => {
      //   const statusEmoji =
      //     {
      //       pending: "⏳ Processing",
      //       waiting_payment: "💳 Awaiting Payment",
      //       payment_sent: "🔄 Payment Verification",
      //       in_progress: "🔄 Processing",
      //       completed: "✅ Completed",
      //       cancelled: "❌ Cancelled",
      //     }[tx.status] || "❓ Unknown"

      //   transactionList += `${index + 1}. ${tx.type.toUpperCase()} ${tx.amount || ""} ${tx.coin}\n`
      //   transactionList += `   🆔 Transaction ID: #${tx.id}\n`
      //   transactionList += `   📊 Status: ${statusEmoji}\n`
      //   transactionList += `   📅 Date: ${new Date(tx.createdAt).toLocaleDateString()}\n\n`
      // })

      // await ctx.reply(transactionList, {
      //   reply_markup: {
      //     keyboard: [[{ text: "🔙 Back to Menu" }]],
      //     resize_keyboard: true,
      //   },
      // });
    } catch (error) {
      console.error("Error showing transactions:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

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

  bot.hears("🔙 Back to Menu", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      // Check if staff member
      if (await canHandleCustomers(userId)) {
        await showAdminPanel(ctx)
        return
      }

      await setUserSession(userId, { step: "main_menu" })

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

  bot.hears("🔍 Custom Token (Contract Address)", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (session.step !== "select_token") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "custom_contract"
      await setUserSession(userId, session)

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

  bot.hears("🔙 Back to Token List", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (session.step !== "custom_contract") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "select_token"
      await setUserSession(userId, session)

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

  bot.hears("✅ I Have Paid", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (session.step !== "payment_sent") {
        await ctx.reply("Please start over with /start")
        return
      }

      session.step = "enter_tx_hash"
      await setUserSession(userId, session)

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

  bot.hears("🔄 New Transaction", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      await setUserSession(userId, { step: "main_menu" })

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
  // COMMANDS
  // ===========================================

  // Start command
  bot.command("start", async (ctx) => {
    try {
      const userId = ctx.from?.id
      if (!userId) return

      // Check if user is staff
      if (await canHandleCustomers(userId)) {
        await showAdminPanel(ctx)
        return
      }

      // Reset user session
      await setUserSession(userId, { step: "start" })

      // Save user info to Firestore
      const user = ctx.from
      await db
        .collection("users")
        .doc(userId.toString())
        .set(
          {
            id: userId,
            username: user.username || null,
            first_name: user.first_name || null,
            last_name: user.last_name || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )

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

      await setUserSession(userId, { step: "main_menu" })
      console.log(`✅ User ${getUserInfo(ctx)} started the bot`)
    } catch (error) {
      console.error("Error in start command:", error)
      await ctx.reply("❌ Sorry, there was an error. Please try again.")
    }
  })

  // Admin Panel Function
  async function showAdminPanel(ctx) {
    const userId = ctx.from?.id
    if (!userId) return

    const staffInfo = await getStaffInfo(userId)

    // Get pending orders count
    const pendingSnapshot = await db.collection("transactions").where("status", "==", "pending").get()

    // Get active chats count
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

    let panelText = `🏪 SHOP KEEPER PANEL\n\n`
    panelText += `👤 Welcome: ${staffInfo}\n`
    panelText += `📊 Pending Orders: ${pendingSnapshot.size}\n`
    panelText += `💬 Active Chats: ${activeChatsSnapshot.size}\n\n`
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

  // Add more handlers here...
  // (I'll continue with the rest of the handlers in the next part)

  // Error handling
  bot.catch((err) => {
    console.error("❌ Bot error:", err)
  })

  console.log("✅ Vintage & Crap Coin Store Bot with Firestore initialized successfully!")
  console.log("👑 Super Admin IDs:", Array.from(SUPER_ADMIN_IDS))
}

// Initialize bot
setupBot().catch((err) => {
  console.error("❌ Error setting up bot:", err)
})

// Express routes
app.get("/", async (req, res) => {
  try {
    // Get stats from Firestore
    const transactionsSnapshot = await db.collection("transactions").get()
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()
    const adminsSnapshot = await db.collection("admins").get()
    const careSnapshot = await db.collection("customerCare").get()

    res.json({
      status: "🏪 Vintage & Crap Coin Store is running with Firestore",
      timestamp: new Date().toISOString(),
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasFirebase: !!process.env.FIREBASE_PROJECT_ID,
      features: [
        "✅ Firebase Firestore Database",
        "✅ Persistent Data Storage",
        "✅ Buy/Sell Crypto with Amount Entry",
        "✅ Professional Customer Service System",
        "✅ BSC Transaction Verification",
        "✅ Wallet & Payment Address Management",
        "✅ Transaction Hash Tracking",
        "✅ Real-time Chat Support",
      ],
      stats: {
        totalTransactions: transactionsSnapshot.size,
        activeChats: activeChatsSnapshot.size,
        totalAdmins: adminsSnapshot.size,
        totalCustomerService: careSnapshot.size,
      },
    })
  } catch (error) {
    console.error("Error getting stats:", error)
    res.json({
      status: "🏪 Vintage & Crap Coin Store is running",
      timestamp: new Date().toISOString(),
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasFirebase: !!process.env.FIREBASE_PROJECT_ID,
      error: "Could not fetch Firestore stats",
    })
  }
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
  console.log("🏪 Vintage & Crap Coin Store with Firestore is ready for business!")
  console.log("📊 Visit the URL to see bot statistics")
})
