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
      return `${care.name} (Customer Service)`
    }

    return "Staff Member"
  } catch (error) {
    console.error("Error getting staff info:", error)
    return "Staff Member"
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

// Admin Panel Function
async function showAdminPanel(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const staffInfo = await getStaffInfo(userId)

    // Get pending orders count (simple query)
    const pendingSnapshot = await db.collection("transactions").where("status", "==", "pending").get()

    // Get active chats count (simple query)
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
  } catch (error) {
    console.error("Error showing admin panel:", error)
    await ctx.reply("❌ Sorry, there was an error loading the admin panel.")
  }
}

// Initialize bot
async function setupBot() {
  try {
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

        const amountDisplay =
          session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`

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

        const ordersSnapshot = await db.collection("transactions").where("status", "==", "pending").get()

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

        // Sort by createdAt in memory and limit to 10
        const sortedDocs = ordersSnapshot.docs
          .sort((a, b) => {
            const aTime = a.data().createdAt?.toDate?.() || new Date(0)
            const bTime = b.data().createdAt?.toDate?.() || new Date(0)
            return bTime - aTime // Descending order
          })
          .slice(0, 10)

        let ordersList = "📋 PENDING ORDERS\n\n"

        sortedDocs.forEach((doc, index) => {
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

        const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

        if (activeChatsSnapshot.empty) {
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

        // Sort by createdAt in memory
        const sortedDocs = activeChatsSnapshot.docs.sort((a, b) => {
          const aTime = a.data().createdAt?.toDate?.() || new Date(0)
          const bTime = b.data().createdAt?.toDate?.() || new Date(0)
          return bTime - aTime // Descending order
        })

        let chatsList = "💬 ACTIVE CHATS\n\n"

        for (const chatDoc of sortedDocs) {
          const chat = chatDoc.data()
          const orderDoc = await db.collection("transactions").doc(chat.orderId).get()
          const order = orderDoc.data()

          if (order) {
            chatsList += `🆔 Order #${chat.orderId}\n`
            chatsList += `🪙 ${order.type.toUpperCase()} ${order.amount} ${order.symbol}\n`
            chatsList += `👤 Customer ID: ${chat.userId}\n`
            chatsList += `👨‍💼 Staff: ${chat.staffId ? await getStaffInfo(chat.staffId) : "Unassigned"}\n\n`
          }
        }

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
        const adminsSnapshot = await db.collection("admins").get()
        if (!adminsSnapshot.empty) {
          staffList += "👑 ADMINS:\n"
          for (const adminDoc of adminsSnapshot.docs) {
            const admin = adminDoc.data()
            staffList += `• ${admin.name} (${admin.role}) - ID: ${adminDoc.id}\n`
          }
          staffList += "\n"
        }

        // List all customer care reps
        const careSnapshot = await db.collection("customerCare").get()
        if (!careSnapshot.empty) {
          staffList += "👥 CUSTOMER SERVICE:\n"
          for (const careDoc of careSnapshot.docs) {
            const care = careDoc.data()
            staffList += `• ${care.name} - ID: ${careDoc.id}\n`
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

    bot.hears("📊 Statistics", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !isSuperAdmin(userId)) {
          await ctx.reply("❌ Only super admins can view statistics.")
          return
        }

        console.log(`Super Admin ${userId} clicked Statistics`)

        // Get statistics from Firestore using simple queries
        const usersSnapshot = await db.collection("users").get()
        const transactionsSnapshot = await db.collection("transactions").get()
        const adminsSnapshot = await db.collection("admins").get()
        const careSnapshot = await db.collection("customerCare").get()
        const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

        const totalUsers = usersSnapshot.size
        const totalTransactions = transactionsSnapshot.size
        const totalAdmins = adminsSnapshot.size
        const totalCustomerCare = careSnapshot.size
        const activeChats = activeChatsSnapshot.size

        // Count transaction statuses in memory
        let pendingOrders = 0
        let completedOrders = 0
        let cancelledOrders = 0
        let todayTransactions = 0

        const today = new Date().toDateString()

        transactionsSnapshot.docs.forEach((doc) => {
          const tx = doc.data()
          if (tx.status === "pending") pendingOrders++
          if (tx.status === "completed") completedOrders++
          if (tx.status === "cancelled") cancelledOrders++

          if (tx.createdAt && tx.createdAt.toDate().toDateString() === today) {
            todayTransactions++
          }
        })

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
        statsText += `• Active Chats: ${activeChats}\n\n`

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

        const userTransactionsSnapshot = await db.collection("transactions").where("userId", "==", userId).get()

        if (userTransactionsSnapshot.empty) {
          await ctx.reply(
            "📊 YOUR TRANSACTIONS\n\n" +
              "You have no transactions yet.\n\n" +
              "Start trading by selecting Buy or Sell!",
            {
              reply_markup: {
                keyboard: [[{ text: "🔙 Back to Menu" }]],
                resize_keyboard: true,
              },
            },
          )
          return
        }

        // Sort by createdAt in memory and limit to 10
        const sortedDocs = userTransactionsSnapshot.docs
          .sort((a, b) => {
            const aTime = a.data().createdAt?.toDate?.() || new Date(0)
            const bTime = b.data().createdAt?.toDate?.() || new Date(0)
            return bTime - aTime // Descending order
          })
          .slice(0, 10)

        let transactionList = "📊 YOUR RECENT TRANSACTIONS\n\n"

        sortedDocs.forEach((doc, index) => {
          const tx = doc.data()
          const statusEmoji =
            {
              pending: "⏳ Processing",
              waiting_payment: "💳 Awaiting Payment",
              payment_sent: "🔄 Payment Verification",
              in_progress: "🔄 Processing",
              completed: "✅ Completed",
              cancelled: "❌ Cancelled",
            }[tx.status] || "❓ Unknown"

          const amountDisplay = tx.type === "buy" ? `$${tx.amount} USD worth of` : `${tx.amount}`

          transactionList += `${index + 1}. ${tx.type.toUpperCase()} ${amountDisplay} ${tx.symbol}\n`
          transactionList += `   🆔 Transaction ID: #${tx.id}\n`
          transactionList += `   📊 Status: ${statusEmoji}\n`
          transactionList += `   📅 Date: ${tx.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}\n\n`
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

    // Admin Commands
    bot.command("take", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await canHandleCustomers(userId))) {
          await ctx.reply("❌ You are not authorized to use this command.")
          return
        }

        const orderId = ctx.match?.trim()
        if (!orderId) {
          await ctx.reply("❌ Please provide an order ID: /take [order_id]")
          return
        }

        // Get transaction
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.status !== "pending") {
          await ctx.reply("❌ This order is not available for assignment.")
          return
        }

        // Update transaction
        await db.collection("transactions").doc(orderId).update({
          status: "in_progress",
          assignedStaff: userId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Update chat session
        await db.collection("chatSessions").doc(orderId).update({
          staffId: userId,
          status: "active",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        const staffInfo = await getStaffInfo(userId)
        const amountDisplay =
          transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

        await ctx.reply(
          `✅ ORDER ASSIGNED\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `🔄 Action: ${transaction.type.toUpperCase()}\n` +
            `🪙 Token: ${transaction.symbol} (${transaction.coin})\n` +
            `💰 Amount: ${amountDisplay} ${transaction.symbol}\n` +
            `👤 Customer ID: ${transaction.userId}\n\n` +
            `💬 You can now chat with the customer. All messages will be forwarded.\n\n` +
            `Next steps:\n` +
            `• For BUY orders: /payment ${orderId} [payment_address]\n` +
            `• For SELL orders: /wallet ${orderId} [receiving_address]`,
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `👨‍💼 ${staffInfo} has been assigned to your order #${orderId}!\n\n` +
            `They will assist you with your ${transaction.type} of ${amountDisplay} ${transaction.symbol}.\n\n` +
            `💬 You can chat here and your messages will be forwarded to them.`,
        )

        console.log(`✅ Order ${orderId} assigned to staff ${staffInfo}`)
      } catch (error) {
        console.error("Error in take command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("payment", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await canHandleCustomers(userId))) {
          await ctx.reply("❌ You are not authorized to use this command.")
          return
        }

        const args = ctx.match?.trim().split(" ")
        if (!args || args.length < 2) {
          await ctx.reply("❌ Usage: /payment [order_id] [payment_address]")
          return
        }

        const orderId = args[0]
        const paymentAddress = args.slice(1).join(" ")

        // Get transaction
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.assignedStaff !== userId) {
          await ctx.reply("❌ You are not assigned to this order.")
          return
        }

        if (transaction.type !== "buy") {
          await ctx.reply("❌ This command is only for BUY orders.")
          return
        }

        // Update transaction
        await db.collection("transactions").doc(orderId).update({
          status: "waiting_payment",
          paymentAddress: paymentAddress,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        const amountDisplay = `$${transaction.amount} USD worth of`

        await ctx.reply(
          `✅ PAYMENT ADDRESS SENT\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `💰 Amount: ${amountDisplay} ${transaction.symbol}\n` +
            `📍 Payment Address: ${paymentAddress}\n\n` +
            `Customer has been notified. Waiting for payment...`,
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `💳 PAYMENT REQUIRED\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `💰 Amount to pay: ${amountDisplay} ${transaction.symbol}\n` +
            `📍 Send payment to: \`${paymentAddress}\`\n\n` +
            `⚠️ Please send the exact amount to the address above.\n` +
            `📝 After payment, provide your transaction hash for verification.`,
          { parse_mode: "Markdown" },
        )

        console.log(`✅ Payment address sent for order ${orderId}`)
      } catch (error) {
        console.error("Error in payment command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("wallet", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await canHandleCustomers(userId))) {
          await ctx.reply("❌ You are not authorized to use this command.")
          return
        }

        const args = ctx.match?.trim().split(" ")
        if (!args || args.length < 2) {
          await ctx.reply("❌ Usage: /wallet [order_id] [receiving_address]")
          return
        }

        const orderId = args[0]
        const receivingAddress = args.slice(1).join(" ")

        // Get transaction
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.assignedStaff !== userId) {
          await ctx.reply("❌ You are not assigned to this order.")
          return
        }

        if (transaction.type !== "sell") {
          await ctx.reply("❌ This command is only for SELL orders.")
          return
        }

        // Update transaction
        await db.collection("transactions").doc(orderId).update({
          status: "waiting_tokens",
          receivingAddress: receivingAddress,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ RECEIVING ADDRESS SENT\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `💰 Amount: ${transaction.amount} ${transaction.symbol}\n` +
            `📍 Receiving Address: ${receivingAddress}\n\n` +
            `Customer has been notified. Waiting for tokens...`,
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `📤 SEND YOUR TOKENS\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `💰 Amount to send: ${transaction.amount} ${transaction.symbol}\n` +
            `📍 Send tokens to: \`${receivingAddress}\`\n\n` +
            `⚠️ Please send the exact amount to the address above.\n` +
            `📝 After sending, provide your transaction hash for verification.`,
          { parse_mode: "Markdown" },
        )

        console.log(`✅ Receiving address sent for order ${orderId}`)
      } catch (error) {
        console.error("Error in wallet command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("send", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await canHandleCustomers(userId))) {
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

        // Get transaction
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.assignedStaff !== userId) {
          await ctx.reply("❌ You are not assigned to this order.")
          return
        }

        // Update transaction
        await db.collection("transactions").doc(orderId).update({
          status: "tokens_sent",
          sentAmount: amount,
          sentTxHash: txHash,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ TOKENS SENT\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `💰 Amount sent: ${amount} ${transaction.symbol}\n` +
            `📝 Transaction Hash: ${txHash}\n\n` +
            `Customer has been notified. Use /complete ${orderId} to finish the order.`,
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `✅ TOKENS RECEIVED!\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `💰 Amount: ${amount} ${transaction.symbol}\n` +
            `📝 Transaction Hash: \`${txHash}\`\n\n` +
            `🎉 Your tokens have been sent! Please check your wallet.\n` +
            `🔍 Verify on BSCScan: https://bscscan.com/tx/${txHash}`,
          { parse_mode: "Markdown" },
        )

        console.log(`✅ Tokens sent for order ${orderId}`)
      } catch (error) {
        console.error("Error in send command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("complete", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await canHandleCustomers(userId))) {
          await ctx.reply("❌ You are not authorized to use this command.")
          return
        }

        const orderId = ctx.match?.trim()
        if (!orderId) {
          await ctx.reply("❌ Please provide an order ID: /complete [order_id]")
          return
        }

        // Get transaction
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.assignedStaff !== userId) {
          await ctx.reply("❌ You are not assigned to this order.")
          return
        }

        // Update transaction
        await db.collection("transactions").doc(orderId).update({
          status: "completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Update chat session
        await db.collection("chatSessions").doc(orderId).update({
          status: "completed",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        const amountDisplay =
          transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

        await ctx.reply(
          `✅ ORDER COMPLETED\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `🔄 Action: ${transaction.type.toUpperCase()}\n` +
            `💰 Amount: ${amountDisplay} ${transaction.symbol}\n\n` +
            `🎉 Transaction successfully completed!`,
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `🎉 TRANSACTION COMPLETED!\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `🔄 Action: ${transaction.type.toUpperCase()}\n` +
            `💰 Amount: ${amountDisplay} ${transaction.symbol}\n\n` +
            `✅ Your transaction has been successfully completed!\n` +
            `🙏 Thank you for using Vintage & Crap Coin Store!\n\n` +
            `💬 Type /start to make another transaction.`,
        )

        console.log(`✅ Order ${orderId} completed by staff ${await getStaffInfo(userId)}`)
      } catch (error) {
        console.error("Error in complete command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("cancel", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await canHandleCustomers(userId))) {
          await ctx.reply("❌ You are not authorized to use this command.")
          return
        }

        const orderId = ctx.match?.trim()
        if (!orderId) {
          await ctx.reply("❌ Please provide an order ID: /cancel [order_id]")
          return
        }

        // Get transaction
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.assignedStaff !== userId) {
          await ctx.reply("❌ You are not assigned to this order.")
          return
        }

        // Update transaction
        await db.collection("transactions").doc(orderId).update({
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Update chat session
        await db.collection("chatSessions").doc(orderId).update({
          status: "cancelled",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        const amountDisplay =
          transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

        await ctx.reply(
          `❌ ORDER CANCELLED\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `🔄 Action: ${transaction.type.toUpperCase()}\n` +
            `💰 Amount: ${amountDisplay} ${transaction.symbol}\n\n` +
            `Order has been cancelled.`,
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `❌ TRANSACTION CANCELLED\n\n` +
            `🆔 Order ID: #${orderId}\n` +
            `🔄 Action: ${transaction.type.toUpperCase()}\n` +
            `💰 Amount: ${amountDisplay} ${transaction.symbol}\n\n` +
            `Your transaction has been cancelled.\n` +
            `💬 Type /start to make a new transaction.`,
        )

        console.log(`❌ Order ${orderId} cancelled by staff ${await getStaffInfo(userId)}`)
      } catch (error) {
        console.error("Error in cancel command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Staff Management Commands
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

        // Add to Firestore
        await db.collection("admins").doc(newAdminId).set({
          id: newAdminId,
          role: "admin",
          name: adminName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ ADMIN ADDED\n\n` +
            `👤 Name: ${adminName}\n` +
            `🆔 User ID: ${newAdminId}\n` +
            `👑 Role: Admin\n\n` +
            `They can now manage orders and customer service.`,
        )

        // Notify new admin
        try {
          await bot.api.sendMessage(
            newAdminId,
            `🎉 WELCOME TO THE TEAM!\n\n` +
              `You have been added as an Admin for Vintage & Crap Coin Store!\n\n` +
              `🏪 You can now:\n` +
              `• Manage customer orders\n` +
              `• Handle customer support\n` +
              `• Add customer service reps\n\n` +
              `💬 Type /start to access the admin panel.`,
          )
        } catch (error) {
          console.log(`Could not notify new admin ${newAdminId}`)
        }

        console.log(`✅ Admin ${adminName} (${newAdminId}) added by ${userId}`)
      } catch (error) {
        console.error("Error in addadmin command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("addcare", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await isAdmin(userId))) {
          await ctx.reply("❌ Only admins can add customer service representatives.")
          return
        }

        const args = ctx.match?.trim().split(" ")
        if (!args || args.length < 2) {
          await ctx.reply("❌ Usage: /addcare [user_id] [name]")
          return
        }

        const newCareId = args[0]
        const careName = args.slice(1).join(" ")

        // Add to Firestore
        await db.collection("customerCare").doc(newCareId).set({
          id: newCareId,
          name: careName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ CUSTOMER SERVICE REP ADDED\n\n` +
            `👤 Name: ${careName}\n` +
            `🆔 User ID: ${newCareId}\n` +
            `👥 Role: Customer Service\n\n` +
            `They can now handle customer orders and support.`,
        )

        // Notify new customer service rep
        try {
          await bot.api.sendMessage(
            newCareId,
            `🎉 WELCOME TO THE TEAM!\n\n` +
              `You have been added as a Customer Service Representative for Vintage & Crap Coin Store!\n\n` +
              `🏪 You can now:\n` +
              `• Handle customer orders\n` +
              `• Provide customer support\n` +
              `• Process transactions\n\n` +
              `💬 Type /start to access the customer service panel.`,
          )
        } catch (error) {
          console.log(`Could not notify new customer service rep ${newCareId}`)
        }

        console.log(`✅ Customer service rep ${careName} (${newCareId}) added by ${userId}`)
      } catch (error) {
        console.error("Error in addcare command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.command("removestaff", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !isSuperAdmin(userId)) {
          await ctx.reply("❌ Only super admins can remove staff members.")
          return
        }

        const staffId = ctx.match?.trim()
        if (!staffId) {
          await ctx.reply("❌ Usage: /removestaff [user_id]")
          return
        }

        if (isSuperAdmin(staffId)) {
          await ctx.reply("❌ Cannot remove super admin.")
          return
        }

        // Check if admin
        const adminDoc = await db.collection("admins").doc(staffId).get()
        if (adminDoc.exists) {
          await db.collection("admins").doc(staffId).delete()
          const admin = adminDoc.data()
          await ctx.reply(`✅ Admin ${admin.name} (${staffId}) has been removed.`)
          console.log(`✅ Admin ${admin.name} (${staffId}) removed by ${userId}`)
          return
        }

        // Check if customer care
        const careDoc = await db.collection("customerCare").doc(staffId).get()
        if (careDoc.exists) {
          await db.collection("customerCare").doc(staffId).delete()
          const care = careDoc.data()
          await ctx.reply(`✅ Customer service rep ${care.name} (${staffId}) has been removed.`)
          console.log(`✅ Customer service rep ${care.name} (${staffId}) removed by ${userId}`)
          return
        }

        await ctx.reply("❌ Staff member not found.")
      } catch (error) {
        console.error("Error in removestaff command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // ===========================================
    // TEXT MESSAGE HANDLER (MUST COME LAST)
    // ===========================================

    bot.on("message:text", async (ctx) => {
      try {
        const userId = ctx.from?.id
        const messageText = ctx.message?.text
        if (!userId || !messageText) return

        const session = await getUserSession(userId)

        // Handle amount entry
        if (session.step === "enter_amount") {
          if (!isValidAmount(messageText)) {
            await ctx.reply(
              "❌ Invalid amount. Please enter a valid number.\n\n" + "📝 Example: 100 (for $100 USD or 100 tokens)",
            )
            return
          }

          session.amount = messageText
          session.step = "confirm_transaction"
          await setUserSession(userId, session)

          const amountDisplay =
            session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`
          const tokenInfo = session.contractAddress ? `\n📍 Contract: ${session.contractAddress}` : ""

          await ctx.reply(
            `📋 TRANSACTION CONFIRMATION\n\n` +
              `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
              `🪙 Token: ${session.symbol} (${session.coin})\n` +
              `💰 Amount: ${amountDisplay} ${session.symbol}${tokenInfo}\n\n` +
              `⚠️ Please review your transaction details carefully.\n\n` +
              `Do you want to proceed?`,
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

        // Handle custom contract address entry
        if (session.step === "custom_contract") {
          if (!isValidContractAddress(messageText)) {
            await ctx.reply(
              "❌ Invalid contract address format!\n\n" +
                "Please provide a valid Ethereum contract address starting with 0x followed by 40 hexadecimal characters.\n\n" +
                "📝 Example: 0x1234567890abcdef1234567890abcdef12345678",
            )
            return
          }

          // Check if it's a known token
          const knownToken = findTokenByContract(messageText)

          let tokenInfo
          let tokenName
          let tokenSymbol

          if (knownToken) {
            tokenInfo = getTokenDisplayInfo(knownToken)
            tokenName = knownToken.name
            tokenSymbol = knownToken.symbol
          } else {
            tokenInfo = `📋 Custom Token Information:
🏷️ Name: Unknown Token
🔤 Symbol: Unknown
📍 Contract: ${messageText}

⚠️ This is a custom token not in our predefined list.`
            tokenName = `Custom Token (${messageText.substring(0, 8)}...)`
            tokenSymbol = "CUSTOM"
          }

          session.coin = tokenName
          session.symbol = tokenSymbol
          session.contractAddress = messageText
          session.step = "enter_amount"
          await setUserSession(userId, session)

          const actionText = session.transactionType === "buy" ? "purchase" : "sell"
          const amountText = session.transactionType === "buy" ? "How much USD worth" : "How many tokens"

          await ctx.reply(
            `${tokenInfo}\n\n` +
              `💰 AMOUNT ENTRY\n\n` +
              `${amountText} of this token would you like to ${actionText}?\n\n` +
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

        // Handle transaction hash entry
        if (session.step === "enter_tx_hash") {
          if (!isValidTxHash(messageText)) {
            await ctx.reply(
              "❌ Invalid transaction hash format!\n\n" +
                "Please provide a valid transaction hash starting with 0x followed by 64 hexadecimal characters.\n\n" +
                "📝 Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            )
            return
          }

          // Update transaction with hash
          if (session.orderId) {
            await db.collection("transactions").doc(session.orderId).update({
              customerTxHash: messageText,
              status: "payment_sent",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            })

            // Notify staff
            const transactionDoc = await db.collection("transactions").doc(session.orderId).get()
            const transaction = transactionDoc.data()

            if (transaction && transaction.assignedStaff) {
              await bot.api.sendMessage(
                transaction.assignedStaff,
                `💳 PAYMENT RECEIVED!\n\n` +
                  `🆔 Order ID: #${session.orderId}\n` +
                  `📝 Transaction Hash: ${messageText}\n` +
                  `🔍 Verify on BSCScan: https://bscscan.com/tx/${messageText}\n\n` +
                  `Please verify the payment and proceed with the order.`,
              )
            }
          }

          session.step = "chat_with_support"
          await setUserSession(userId, session)

          await ctx.reply(
            `✅ TRANSACTION HASH RECEIVED\n\n` +
              `📝 Hash: ${messageText}\n` +
              `🔍 Verify: https://bscscan.com/tx/${messageText}\n\n` +
              `Our team is verifying your payment. You'll be notified once confirmed.\n\n` +
              `💬 You can continue chatting here for any questions.`,
            {
              reply_markup: {
                keyboard: [[{ text: "🔄 New Transaction" }, { text: "📊 My Transactions" }]],
                resize_keyboard: true,
              },
            },
          )
          return
        }

        // Handle chat with support
        if (session.step === "chat_with_support" && session.orderId) {
          // Save message to database
          await db.collection("messages").add({
            orderId: session.orderId,
            senderId: userId,
            senderType: "customer",
            message: messageText,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })

          // Get transaction to find assigned staff
          const transactionDoc = await db.collection("transactions").doc(session.orderId).get()
          const transaction = transactionDoc.data()

          if (transaction && transaction.assignedStaff) {
            // Forward to assigned staff
            await bot.api.sendMessage(
              transaction.assignedStaff,
              `💬 Customer message (Order #${session.orderId}):\n\n"${messageText}"\n\n` +
                `Reply directly to chat with the customer.`,
            )
          } else {
            // Notify all staff if no one assigned
            const adminsSnapshot = await db.collection("admins").get()
            const careSnapshot = await db.collection("customerCare").get()

            const staffNotification = `💬 Customer message (Order #${session.orderId}):\n\n"${messageText}"\n\nUse /take ${session.orderId} to handle this order.`

            for (const adminDoc of adminsSnapshot.docs) {
              try {
                await bot.api.sendMessage(adminDoc.id, staffNotification)
              } catch (error) {
                console.error(`Error notifying admin ${adminDoc.id}:`, error)
              }
            }

            for (const careDoc of careSnapshot.docs) {
              try {
                await bot.api.sendMessage(careDoc.id, staffNotification)
              } catch (error) {
                console.error(`Error notifying care rep ${careDoc.id}:`, error)
              }
            }
          }

          await ctx.reply("📤 Your message has been sent to our team. Please wait for a response.")
          return
        }

        // Handle staff messages
        if (await canHandleCustomers(userId)) {
          // Check if staff has an active chat
          const activeChatsSnapshot = await db
            .collection("chatSessions")
            .where("staffId", "==", userId)
            .where("status", "==", "active")
            .get()

          if (!activeChatsSnapshot.empty) {
            const chatSession = activeChatsSnapshot.docs[0].data()
            const orderId = chatSession.orderId

            // Save message to database
            await db.collection("messages").add({
              orderId: orderId,
              senderId: userId,
              senderType: "staff",
              message: messageText,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })

            // Get transaction to find customer
            const transactionDoc = await db.collection("transactions").doc(orderId).get()
            const transaction = transactionDoc.data()

            if (transaction) {
              const staffInfo = await getStaffInfo(userId)
              await bot.api.sendMessage(transaction.userId, `👨‍💼 ${staffInfo}: ${messageText}`)

              await ctx.reply(`📤 Message sent to customer (Order #${orderId})`)
            }
            return
          }

          // If no active chat, show available commands
          await ctx.reply(
            "💬 You don't have any active chats.\n\n" +
              "Use /take [order_id] to handle a customer order, or check the admin panel for pending orders.",
          )
          return
        }

        // Default fallback for regular users
        await ctx.reply("🤔 I didn't understand that. Please use the menu buttons or type /start to begin.", {
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
        console.error("Error in text handler:", error)
        await ctx.reply("❌ Sorry, there was an error processing your message. Please try again.")
      }
    })

    // Error handling
    bot.catch((err) => {
      console.error("❌ Bot error:", err)
    })

    console.log("✅ Vintage & Crap Coin Store Bot with Firestore initialized successfully!")
    console.log("👑 Super Admin IDs:", Array.from(SUPER_ADMIN_IDS))
  } catch (error) {
    console.error("❌ Error setting up bot:", error)
  }
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
