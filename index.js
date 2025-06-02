const express = require("express")
const { Bot, InlineKeyboard } = require("grammy")
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

// SUPER ADMIN IDs
const SUPER_ADMIN_IDS = new Set(["7763673217", "7477411555"])

// Bot-like names for staff
const BOT_NAMES = [
  "SupportBot",
  "TradeBot",
  "CryptoBot",
  "AssistBot",
  "ServiceBot",
  "HelpBot",
  "ExchangeBot",
  "PaymentBot",
  "VerifyBot",
  "ProcessBot",
  "AdminBot",
  "ManagerBot",
  "SuperBot",
  "ChiefBot",
  "LeadBot",
]

// Create main bot instance
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN)

// Create notification bot instance (separate bot for staff notifications)
const notificationBot = process.env.NOTIFICATION_BOT_TOKEN ? new Bot(process.env.NOTIFICATION_BOT_TOKEN) : null

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

function generateBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]
}

// Enhanced Firestore helper functions
async function isAdmin(userId) {
  try {
    const userRole = await getUserRoleFromFirestore(userId)
    return userRole && (userRole.type === "admin" || userRole.type === "super_admin")
  } catch (error) {
    console.error("Error checking admin status:", error)
    return false
  }
}

async function canHandleCustomers(userId) {
  try {
    if (!userId) return false
    const userRole = await getUserRoleFromFirestore(userId)
    if (userRole) {
      console.log(`User ${userId} has role: ${userRole.type}`)
      return true
    }
    console.log(`User ${userId} has no staff role`)
    return false
  } catch (error) {
    console.error(`Error checking staff status for ${userId}:`, error)
    return false
  }
}

async function getStaffDisplayName(userId) {
  try {
    const userRole = await getUserRoleFromFirestore(userId)
    if (userRole && userRole.data) {
      return userRole.data.displayName || userRole.data.name || "SupportBot"
    }
    return "SupportBot"
  } catch (error) {
    console.error("Error getting staff display name:", error)
    return "SupportBot"
  }
}

async function getStaffInfo(userId) {
  try {
    const userRole = await getUserRoleFromFirestore(userId)
    if (userRole && userRole.data) {
      const name = userRole.data.name || "Staff Member"
      const roleDisplay =
        {
          super_admin: "Super Admin",
          admin: "Admin",
          customer_care: "Customer Service",
        }[userRole.type] || "Staff"
      return `${name} (${roleDisplay})`
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

async function getUserRoleFromFirestore(userId) {
  try {
    if (!userId) return null

    if (isSuperAdmin(userId)) {
      const adminDoc = await db.collection("admins").doc(userId.toString()).get()
      if (adminDoc.exists) {
        return {
          type: "super_admin",
          data: adminDoc.data(),
        }
      }
    }

    const adminDoc = await db.collection("admins").doc(userId.toString()).get()
    if (adminDoc.exists) {
      const adminData = adminDoc.data()
      return {
        type: "admin",
        data: adminData,
      }
    }

    const careDoc = await db.collection("customerCare").doc(userId.toString()).get()
    if (careDoc.exists) {
      const careData = careDoc.data()
      return {
        type: "customer_care",
        data: careData,
      }
    }

    return null
  } catch (error) {
    console.error(`Error checking user role for ${userId}:`, error)
    return null
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
          displayName: "AdminBot",
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

// Enhanced notification system
async function sendStaffNotification(message, orderId = null, priority = "normal") {
  try {
    // Create inline keyboard for quick actions
    const keyboard = new InlineKeyboard()

    if (orderId) {
      keyboard
        .text("🎯 Take Order", `take_${orderId}`)
        .text("👀 View Details", `view_${orderId}`)
        .row()
        .text("📋 All Orders", "view_all_orders")
    }

    // Get all staff members
    const adminsSnapshot = await db.collection("admins").get()
    const careSnapshot = await db.collection("customerCare").get()

    const allStaff = []
    adminsSnapshot.docs.forEach((doc) => allStaff.push(doc.id))
    careSnapshot.docs.forEach((doc) => allStaff.push(doc.id))

    // Send to notification bot if available, otherwise main bot
    const botToUse = notificationBot || bot

    for (const staffId of allStaff) {
      try {
        await botToUse.api.sendMessage(staffId, message, {
          reply_markup: keyboard,
          parse_mode: "HTML",
        })
      } catch (error) {
        console.error(`Error notifying staff ${staffId}:`, error)
      }
    }
  } catch (error) {
    console.error("Error sending staff notification:", error)
  }
}

// Enhanced admin panel with inline keyboards
async function showEnhancedAdminPanel(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    await setUserSession(userId, {
      step: "admin_panel",
      isStaff: true,
      lastAccessed: new Date().toISOString(),
    })

    const staffInfo = await getStaffInfo(userId)
    const staffDisplayName = await getStaffDisplayName(userId)

    // Get pending orders count
    const pendingSnapshot = await db.collection("transactions").where("status", "==", "pending").get()
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

    let panelText = `🏪 <b>STAFF CONTROL PANEL</b>\n\n`
    panelText += `👤 Welcome: <b>${staffInfo}</b>\n`
    panelText += `🤖 Your Agent Name: <b>${staffDisplayName}</b>\n`
    panelText += `📊 Pending Orders: <b>${pendingSnapshot.size}</b>\n`
    panelText += `💬 Active Chats: <b>${activeChatsSnapshot.size}</b>\n\n`
    panelText += `Choose an action below:`

    const keyboard = new InlineKeyboard()
      .text("📋 View Orders", "view_orders")
      .text("💬 Active Chats", "view_chats")
      .row()

    if (await isAdmin(userId)) {
      keyboard.text("👥 Manage Staff", "manage_staff").text("📊 Statistics", "view_stats").row()
    }

    keyboard.text("❓ Help Guide", "staff_help")

    await ctx.reply(panelText, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    })

    console.log(`✅ Enhanced admin panel shown to staff member ${userId}`)
  } catch (error) {
    console.error("Error showing enhanced admin panel:", error)
    await ctx.reply("❌ Sorry, there was an error loading the admin panel.")
  }
}

// Enhanced order viewing with clickable actions
async function showOrdersWithActions(ctx, page = 0) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) return

    const ordersSnapshot = await db.collection("transactions").where("status", "==", "pending").get()

    if (ordersSnapshot.empty) {
      const keyboard = new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel")

      await ctx.reply(
        "📋 <b>PENDING ORDERS</b>\n\n" +
          "No pending orders at the moment.\n\n" +
          "New orders will appear here automatically.",
        {
          reply_markup: keyboard,
          parse_mode: "HTML",
        },
      )
      return
    }

    // Sort and paginate
    const sortedDocs = ordersSnapshot.docs.sort((a, b) => {
      const aTime = a.data().createdAt?.toDate?.() || new Date(0)
      const bTime = b.data().createdAt?.toDate?.() || new Date(0)
      return bTime - aTime
    })

    const itemsPerPage = 5
    const startIndex = page * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const pageOrders = sortedDocs.slice(startIndex, endIndex)

    let ordersList = `📋 <b>PENDING ORDERS</b> (Page ${page + 1})\n\n`

    const keyboard = new InlineKeyboard()

    pageOrders.forEach((doc, index) => {
      const order = doc.data()
      const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`
      const timeAgo = getTimeAgo(order.createdAt?.toDate?.())

      ordersList += `<b>${startIndex + index + 1}.</b> ${order.type.toUpperCase()} ${amountDisplay} ${order.symbol}\n`
      ordersList += `   🆔 ID: <code>#${order.id}</code>\n`
      ordersList += `   ⏰ ${timeAgo}\n`
      ordersList += `   👤 Customer: ${order.userId}\n\n`

      // Add action buttons for each order
      keyboard
        .text(`🎯 Take #${order.id.slice(-4)}`, `take_${order.id}`)
        .text(`👀 View #${order.id.slice(-4)}`, `view_${order.id}`)
        .row()
    })

    // Navigation buttons
    if (page > 0) {
      keyboard.text("⬅️ Previous", `orders_page_${page - 1}`)
    }
    if (endIndex < sortedDocs.length) {
      keyboard.text("➡️ Next", `orders_page_${page + 1}`)
    }
    if (page > 0 || endIndex < sortedDocs.length) {
      keyboard.row()
    }

    keyboard.text("🔄 Refresh", "view_orders").text("🔙 Back to Panel", "back_to_panel")

    await ctx.reply(ordersList, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    })
  } catch (error) {
    console.error("Error showing orders with actions:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Helper function to get time ago
function getTimeAgo(date) {
  if (!date) return "Just now"

  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

// Enhanced order details view
async function showOrderDetails(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) return

    const transactionDoc = await db.collection("transactions").doc(orderId).get()
    if (!transactionDoc.exists) {
      await ctx.reply("❌ Order not found.")
      return
    }

    const transaction = transactionDoc.data()
    const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

    // Get customer info
    const customerDoc = await db.collection("users").doc(transaction.userId.toString()).get()
    const customer = customerDoc.data()
    const customerName = customer?.username ? `@${customer.username}` : customer?.first_name || "Unknown"

    let detailsText = `📋 <b>ORDER DETAILS</b>\n\n`
    detailsText += `🆔 Order ID: <code>#${orderId}</code>\n`
    detailsText += `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n`
    detailsText += `🪙 Token: <b>${transaction.symbol}</b> (${transaction.coin})\n`
    detailsText += `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n`
    detailsText += `👤 Customer: <b>${customerName}</b> (ID: ${transaction.userId})\n`
    detailsText += `📅 Created: ${transaction.createdAt?.toDate?.()?.toLocaleString() || "Unknown"}\n`
    detailsText += `📊 Status: <b>${transaction.status}</b>\n`

    if (transaction.contractAddress) {
      detailsText += `📍 Contract: <code>${transaction.contractAddress}</code>\n`
    }

    const keyboard = new InlineKeyboard()

    if (transaction.status === "pending") {
      keyboard.text("🎯 Take This Order", `take_${orderId}`).text("💬 Chat Customer", `chat_${orderId}`).row()
    } else if (transaction.assignedStaff === userId) {
      // Show relevant actions based on status
      if (transaction.type === "buy" && !transaction.paymentAddress) {
        keyboard.text("💳 Send Payment Address", `payment_${orderId}`)
      }
      if (transaction.type === "sell" && !transaction.receivingAddress) {
        keyboard.text("📤 Send Wallet Address", `wallet_${orderId}`)
      }
      if (transaction.status === "payment_sent" || transaction.status === "tokens_sent") {
        keyboard.text("✅ Complete Order", `complete_${orderId}`)
      }
      keyboard.text("❌ Cancel Order", `cancel_${orderId}`).text("💬 Chat Customer", `chat_${orderId}`).row()
    }

    keyboard.text("🔄 Refresh", `view_${orderId}`).text("📋 Back to Orders", "view_orders")

    await ctx.reply(detailsText, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    })
  } catch (error) {
    console.error("Error showing order details:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Enhanced take order function
async function takeOrder(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      await ctx.reply("❌ You are not authorized to take orders.")
      return
    }

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

    const staffDisplayName = await getStaffDisplayName(userId)
    const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

    // Success message with next steps
    let successText = `✅ <b>ORDER ASSIGNED SUCCESSFULLY!</b>\n\n`
    successText += `🆔 Order ID: <code>#${orderId}</code>\n`
    successText += `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n`
    successText += `🪙 Token: <b>${transaction.symbol}</b>\n`
    successText += `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n`
    successText += `👤 Customer ID: ${transaction.userId}\n\n`
    successText += `🎯 <b>NEXT STEPS:</b>\n`

    const keyboard = new InlineKeyboard()

    if (transaction.type === "buy") {
      successText += `1️⃣ Send payment address to customer\n`
      successText += `2️⃣ Wait for customer payment\n`
      successText += `3️⃣ Verify payment on BSCScan\n`
      successText += `4️⃣ Send tokens to customer\n`

      keyboard.text("💳 Send Payment Address", `payment_${orderId}`).text("💬 Chat Customer", `chat_${orderId}`).row()
    } else {
      successText += `1️⃣ Send receiving wallet address\n`
      successText += `2️⃣ Wait for customer to send tokens\n`
      successText += `3️⃣ Verify tokens received\n`
      successText += `4️⃣ Send payment to customer\n`

      keyboard.text("📤 Send Wallet Address", `wallet_${orderId}`).text("💬 Chat Customer", `chat_${orderId}`).row()
    }

    keyboard.text("👀 View Order Details", `view_${orderId}`).text("📋 Back to Orders", "view_orders")

    await ctx.reply(successText, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    })

    // Notify customer with bot name
    await bot.api.sendMessage(
      transaction.userId,
      `🤖 <b>AGENT ASSIGNED!</b>\n\n` +
        `${staffDisplayName} has been assigned to your order <code>#${orderId}</code>!\n\n` +
        `They will assist you with your ${transaction.type} of ${amountDisplay} ${transaction.symbol}.\n\n` +
        `💬 You can chat here and your messages will be forwarded to them.`,
      { parse_mode: "HTML" },
    )

    console.log(`✅ Order ${orderId} assigned to staff ${await getStaffInfo(userId)}`)
  } catch (error) {
    console.error("Error taking order:", error)
    await ctx.reply("❌ Sorry, there was an error taking the order. Please try again.")
  }
}

// Setup bot with enhanced features
async function setupEnhancedBot() {
  try {
    await bot.init()
    if (notificationBot) {
      await notificationBot.init()
    }
    await initializeSuperAdmins()

    // ===========================================
    // INLINE KEYBOARD HANDLERS
    // ===========================================

    // Handle all callback queries
    bot.on("callback_query:data", async (ctx) => {
      try {
        const data = ctx.callbackQuery.data
        const userId = ctx.from?.id

        if (!userId) return

        // Answer callback query to remove loading state
        await ctx.answerCallbackQuery()

        // Route to appropriate handler
        if (data === "view_orders") {
          await showOrdersWithActions(ctx)
        } else if (data.startsWith("orders_page_")) {
          const page = Number.parseInt(data.split("_")[2])
          await showOrdersWithActions(ctx, page)
        } else if (data.startsWith("take_")) {
          const orderId = data.substring(5)
          await takeOrder(ctx, orderId)
        } else if (data.startsWith("view_")) {
          const orderId = data.substring(5)
          await showOrderDetails(ctx, orderId)
        } else if (data.startsWith("payment_")) {
          const orderId = data.substring(8)
          await handlePaymentAddress(ctx, orderId)
        } else if (data.startsWith("wallet_")) {
          const orderId = data.substring(7)
          await handleWalletAddress(ctx, orderId)
        } else if (data.startsWith("complete_")) {
          const orderId = data.substring(9)
          await completeOrder(ctx, orderId)
        } else if (data.startsWith("cancel_")) {
          const orderId = data.substring(7)
          await cancelOrder(ctx, orderId)
        } else if (data.startsWith("chat_")) {
          const orderId = data.substring(5)
          await startChatWithCustomer(ctx, orderId)
        } else if (data === "back_to_panel") {
          await showEnhancedAdminPanel(ctx)
        } else if (data === "view_chats") {
          await showActiveChats(ctx)
        } else if (data === "manage_staff") {
          await showStaffManagement(ctx)
        } else if (data === "view_stats") {
          await showStatistics(ctx)
        } else if (data === "staff_help") {
          await showStaffHelp(ctx)
        }
      } catch (error) {
        console.error("Error handling callback query:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Enhanced payment address handler
    async function handlePaymentAddress(ctx, orderId) {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      session.step = "enter_payment_address"
      session.currentOrderId = orderId
      await setUserSession(userId, session)

      await ctx.reply(
        `💳 <b>SEND PAYMENT ADDRESS</b>\n\n` +
          `Order ID: <code>#${orderId}</code>\n\n` +
          `Please enter the payment address where the customer should send their payment:\n\n` +
          `📝 Example: 0x1234567890abcdef1234567890abcdef12345678`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("❌ Cancel", `view_${orderId}`),
        },
      )
    }

    // Enhanced wallet address handler
    async function handleWalletAddress(ctx, orderId) {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      session.step = "enter_wallet_address"
      session.currentOrderId = orderId
      await setUserSession(userId, session)

      await ctx.reply(
        `📤 <b>SEND WALLET ADDRESS</b>\n\n` +
          `Order ID: <code>#${orderId}</code>\n\n` +
          `Please enter the wallet address where the customer should send their tokens:\n\n` +
          `📝 Example: 0x1234567890abcdef1234567890abcdef12345678`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("❌ Cancel", `view_${orderId}`),
        },
      )
    }

    // Enhanced complete order function
    async function completeOrder(ctx, orderId) {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

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

      const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

      await ctx.reply(
        `✅ <b>ORDER COMPLETED SUCCESSFULLY!</b>\n\n` +
          `🆔 Order ID: <code>#${orderId}</code>\n` +
          `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n` +
          `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n\n` +
          `🎉 Transaction successfully completed!`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("📋 Back to Orders", "view_orders")
            .text("🏪 Main Panel", "back_to_panel"),
        },
      )

      // Notify customer
      await bot.api.sendMessage(
        transaction.userId,
        `🎉 <b>TRANSACTION COMPLETED!</b>\n\n` +
          `🆔 Order ID: <code>#${orderId}</code>\n` +
          `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n` +
          `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n\n` +
          `✅ Your transaction has been successfully completed!\n` +
          `🙏 Thank you for using Vintage & Crap Coin Store!\n\n` +
          `💬 Type /start to make another transaction.`,
        { parse_mode: "HTML" },
      )

      console.log(`✅ Order ${orderId} completed by staff ${await getStaffInfo(userId)}`)
    }

    // Enhanced cancel order function
    async function cancelOrder(ctx, orderId) {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      // Show confirmation dialog
      await ctx.reply(
        `⚠️ <b>CONFIRM CANCELLATION</b>\n\n` +
          `Are you sure you want to cancel order <code>#${orderId}</code>?\n\n` +
          `This action cannot be undone.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("✅ Yes, Cancel Order", `confirm_cancel_${orderId}`)
            .text("❌ No, Go Back", `view_${orderId}`),
        },
      )
    }

    // Start chat with customer
    async function startChatWithCustomer(ctx, orderId) {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      session.step = "chatting_with_customer"
      session.currentOrderId = orderId
      await setUserSession(userId, session)

      const transactionDoc = await db.collection("transactions").doc(orderId).get()
      const transaction = transactionDoc.data()

      await ctx.reply(
        `💬 <b>CHAT WITH CUSTOMER</b>\n\n` +
          `Order ID: <code>#${orderId}</code>\n` +
          `Customer ID: ${transaction?.userId}\n\n` +
          `You are now in chat mode. Type your message and it will be sent to the customer.\n\n` +
          `💡 Type /endchat to stop chatting.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔚 End Chat", `view_${orderId}`)
            .text("👀 View Order", `view_${orderId}`),
        },
      )
    }

    // Show active chats
    async function showActiveChats(ctx) {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

      if (activeChatsSnapshot.empty) {
        await ctx.reply(
          "💬 <b>ACTIVE CHATS</b>\n\n" +
            "No active chats at the moment.\n\n" +
            "Active conversations will appear here.",
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
          },
        )
        return
      }

      let chatsList = "💬 <b>ACTIVE CHATS</b>\n\n"
      const keyboard = new InlineKeyboard()

      for (const chatDoc of activeChatsSnapshot.docs) {
        const chat = chatDoc.data()
        const orderDoc = await db.collection("transactions").doc(chat.orderId).get()
        const order = orderDoc.data()

        if (order) {
          chatsList += `🆔 Order <code>#${chat.orderId}</code>\n`
          chatsList += `🪙 ${order.type.toUpperCase()} ${order.amount} ${order.symbol}\n`
          chatsList += `👤 Customer: ${chat.userId}\n`
          chatsList += `👨‍💼 Staff: ${chat.staffId ? await getStaffInfo(chat.staffId) : "Unassigned"}\n\n`

          keyboard
            .text(`💬 Chat #${chat.orderId.slice(-4)}`, `chat_${chat.orderId}`)
            .text(`👀 View #${chat.orderId.slice(-4)}`, `view_${chat.orderId}`)
            .row()
        }
      }

      keyboard.text("🔙 Back to Panel", "back_to_panel")

      await ctx.reply(chatsList, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
    }

    // Show staff management
    async function showStaffManagement(ctx) {
      const userId = ctx.from?.id
      if (!userId || !(await isAdmin(userId))) {
        await ctx.reply("❌ Only admins can manage staff.")
        return
      }

      let staffList = "👥 <b>STAFF MANAGEMENT</b>\n\n"

      // List all admins
      const adminsSnapshot = await db.collection("admins").get()
      if (!adminsSnapshot.empty) {
        staffList += "👑 <b>ADMINS:</b>\n"
        for (const adminDoc of adminsSnapshot.docs) {
          const admin = adminDoc.data()
          staffList += `• ${admin.name} (${admin.role}) - ID: ${adminDoc.id}\n`
          if (admin.displayName) {
            staffList += `  🤖 Bot Name: ${admin.displayName}\n`
          }
        }
        staffList += "\n"
      }

      // List all customer care reps
      const careSnapshot = await db.collection("customerCare").get()
      if (!careSnapshot.empty) {
        staffList += "👥 <b>CUSTOMER SERVICE:</b>\n"
        for (const careDoc of careSnapshot.docs) {
          const care = careDoc.data()
          staffList += `• ${care.name} - ID: ${careDoc.id}\n`
          if (care.displayName) {
            staffList += `  🤖 Bot Name: ${care.displayName}\n`
          }
        }
        staffList += "\n"
      }

      staffList += "<b>Commands:</b>\n"
      staffList += "• /addadmin [user_id] [name] - Add new admin\n"
      staffList += "• /addcare [user_id] [name] - Add customer service rep\n"
      staffList += "• /removestaff [user_id] - Remove staff member"

      await ctx.reply(staffList, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
      })
    }

    // Show statistics
    async function showStatistics(ctx) {
      const userId = ctx.from?.id
      if (!userId || !(await isAdmin(userId))) {
        await ctx.reply("❌ Only admins can view statistics.")
        return
      }

      // Get statistics from Firestore
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

      // Count transaction statuses
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

      let statsText = "📊 <b>VINTAGE & CRAP COIN STORE STATISTICS</b>\n\n"
      statsText += "👥 <b>USERS & STAFF:</b>\n"
      statsText += `• Total Users: <b>${totalUsers}</b>\n`
      statsText += `• Total Admins: <b>${totalAdmins}</b>\n`
      statsText += `• Customer Service Reps: <b>${totalCustomerCare}</b>\n\n`

      statsText += "📋 <b>TRANSACTIONS:</b>\n"
      statsText += `• Total Transactions: <b>${totalTransactions}</b>\n`
      statsText += `• Today's Transactions: <b>${todayTransactions}</b>\n`
      statsText += `• Pending: <b>${pendingOrders}</b>\n`
      statsText += `• Completed: <b>${completedOrders}</b>\n`
      statsText += `• Cancelled: <b>${cancelledOrders}</b>\n\n`

      statsText += "💬 <b>CHATS:</b>\n"
      statsText += `• Active Chats: <b>${activeChats}</b>\n\n`

      statsText += `📅 Last Updated: ${new Date().toLocaleString()}`

      await ctx.reply(statsText, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔄 Refresh", "view_stats").text("🔙 Back to Panel", "back_to_panel"),
      })
    }

    // Show staff help
    async function showStaffHelp(ctx) {
      const userId = ctx.from?.id
      if (!userId || !(await canHandleCustomers(userId))) return

      let helpText = "❓ <b>STAFF HELP GUIDE</b>\n\n"

      helpText += "🎯 <b>TAKING ORDERS:</b>\n"
      helpText += "• Click 'View Orders' to see pending orders\n"
      helpText += "• Click '🎯 Take' button next to any order\n"
      helpText += "• No need to type order IDs!\n\n"

      helpText += "💳 <b>BUY ORDER WORKFLOW:</b>\n"
      helpText += "1️⃣ Take the order\n"
      helpText += "2️⃣ Click 'Send Payment Address'\n"
      helpText += "3️⃣ Customer pays and submits hash\n"
      helpText += "4️⃣ Verify payment on BSCScan\n"
      helpText += "5️⃣ Send tokens to customer\n"
      helpText += "6️⃣ Click 'Complete Order'\n\n"

      helpText += "📤 <b>SELL ORDER WORKFLOW:</b>\n"
      helpText += "1️⃣ Take the order\n"
      helpText += "2️⃣ Click 'Send Wallet Address'\n"
      helpText += "3️⃣ Customer sends tokens and submits hash\n"
      helpText += "4️⃣ Verify tokens on BSCScan\n"
      helpText += "5️⃣ Send payment to customer\n"
      helpText += "6️⃣ Click 'Complete Order'\n\n"

      helpText += "💬 <b>CUSTOMER CHAT:</b>\n"
      helpText += "• Click 'Chat Customer' to start chatting\n"
      helpText += "• Type messages normally\n"
      helpText += "• Messages are auto-forwarded\n\n"

      helpText += "🔧 <b>QUICK ACTIONS:</b>\n"
      helpText += "• All actions are clickable buttons\n"
      helpText += "• No need to remember commands\n"
      helpText += "• Use 'Refresh' to update status\n\n"

      if (await isAdmin(userId)) {
        helpText += "👑 <b>ADMIN COMMANDS:</b>\n"
        helpText += "• /addadmin [user_id] [name]\n"
        helpText += "• /addcare [user_id] [name]\n"
        helpText += "• /removestaff [user_id]\n"
      }

      helpText += "\n💡 <b>TIPS:</b>\n"
      helpText += "• Always verify transactions on BSCScan\n"
      helpText += "• Use clickable buttons instead of typing\n"
      helpText += "• Complete or cancel orders when done\n"
      helpText += "• Get user IDs from @userinfobot"

      await ctx.reply(helpText, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
      })
    }

    // ===========================================
    // ENHANCED START COMMAND
    // ===========================================

    bot.command("start", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        console.log(`User ${userId} started the bot - checking role...`)

        const userRole = await getUserRoleFromFirestore(userId)

        if (userRole) {
          console.log(`✅ Staff member ${userId} detected - showing enhanced admin panel`)
          await setUserSession(userId, {
            step: "admin_panel",
            isStaff: true,
            role: userRole.type,
            roleData: userRole.data,
          })
          await showEnhancedAdminPanel(ctx)
          return
        }

        // Regular user interface
        console.log(`Regular user ${userId} detected`)
        await setUserSession(userId, { step: "start", isStaff: false })

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

        await setUserSession(userId, { step: "main_menu", isStaff: false })
        console.log(`✅ Regular user ${getUserInfo(ctx)} started the bot`)
      } catch (error) {
        console.error("Error in start command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // ===========================================
    // TEXT MESSAGE HANDLER
    // ===========================================

    bot.on("message:text", async (ctx) => {
      try {
        const userId = ctx.from?.id
        const messageText = ctx.message?.text
        if (!userId || !messageText) return

        const session = await getUserSession(userId)

        // Handle staff entering addresses
        if (session.step === "enter_payment_address" && session.currentOrderId) {
          if (!isValidContractAddress(messageText)) {
            await ctx.reply("❌ Invalid address format. Please enter a valid wallet address.")
            return
          }

          await db.collection("transactions").doc(session.currentOrderId).update({
            status: "waiting_payment",
            paymentAddress: messageText,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })

          const transactionDoc = await db.collection("transactions").doc(session.currentOrderId).get()
          const transaction = transactionDoc.data()
          const staffDisplayName = await getStaffDisplayName(userId)
          const amountDisplay = `$${transaction.amount} USD worth of`

          await ctx.reply(
            `✅ <b>PAYMENT ADDRESS SENT!</b>\n\n` +
              `🆔 Order ID: <code>#${session.currentOrderId}</code>\n` +
              `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n` +
              `📍 Payment Address: <code>${messageText}</code>\n\n` +
              `Customer has been notified and is waiting for payment instructions.`,
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard()
                .text("👀 View Order", `view_${session.currentOrderId}`)
                .text("📋 Back to Orders", "view_orders"),
            },
          )

          // Notify customer
          await bot.api.sendMessage(
            transaction.userId,
            `💳 <b>PAYMENT INSTRUCTIONS</b>\n\n` +
              `🆔 Order ID: <code>#${session.currentOrderId}</code>\n` +
              `🤖 Agent: <b>${staffDisplayName}</b>\n\n` +
              `💰 Amount to pay: <b>${amountDisplay} ${transaction.symbol}</b>\n` +
              `📍 Send payment to: <code>${messageText}</code>\n\n` +
              `⚠️ <b>IMPORTANT:</b>\n` +
              `• Send the exact amount\n` +
              `• Use the correct network (BSC)\n` +
              `• After payment, go to "My Transactions" and submit your transaction hash`,
            { parse_mode: "HTML" },
          )

          session.step = "admin_panel"
          delete session.currentOrderId
          await setUserSession(userId, session)
          return
        }

        if (session.step === "enter_wallet_address" && session.currentOrderId) {
          if (!isValidContractAddress(messageText)) {
            await ctx.reply("❌ Invalid address format. Please enter a valid wallet address.")
            return
          }

          await db.collection("transactions").doc(session.currentOrderId).update({
            status: "waiting_tokens",
            receivingAddress: messageText,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })

          const transactionDoc = await db.collection("transactions").doc(session.currentOrderId).get()
          const transaction = transactionDoc.data()
          const staffDisplayName = await getStaffDisplayName(userId)

          await ctx.reply(
            `✅ <b>WALLET ADDRESS SENT!</b>\n\n` +
              `🆔 Order ID: <code>#${session.currentOrderId}</code>\n` +
              `💰 Amount: <b>${transaction.amount} ${transaction.symbol}</b>\n` +
              `📍 Receiving Address: <code>${messageText}</code>\n\n` +
              `Customer has been notified and is waiting for token sending instructions.`,
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard()
                .text("👀 View Order", `view_${session.currentOrderId}`)
                .text("📋 Back to Orders", "view_orders"),
            },
          )

          // Notify customer
          await bot.api.sendMessage(
            transaction.userId,
            `📤 <b>TOKEN SENDING INSTRUCTIONS</b>\n\n` +
              `🆔 Order ID: <code>#${session.currentOrderId}</code>\n` +
              `🤖 Agent: <b>${staffDisplayName}</b>\n\n` +
              `💰 Amount to send: <b>${transaction.amount} ${transaction.symbol}</b>\n` +
              `📍 Send tokens to: <code>${messageText}</code>\n\n` +
              `⚠️ <b>IMPORTANT:</b>\n` +
              `• Send the exact amount\n` +
              `• Use the correct network (BSC)\n` +
              `• After sending, go to "My Transactions" and submit your transaction hash`,
            { parse_mode: "HTML" },
          )

          session.step = "admin_panel"
          delete session.currentOrderId
          await setUserSession(userId, session)
          return
        }

        // Handle staff chatting with customers
        if (session.step === "chatting_with_customer" && session.currentOrderId) {
          // Save message to database
          await db.collection("messages").add({
            orderId: session.currentOrderId,
            senderId: userId,
            senderType: "staff",
            message: messageText,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })

          // Get transaction to find customer
          const transactionDoc = await db.collection("transactions").doc(session.currentOrderId).get()
          const transaction = transactionDoc.data()

          if (transaction) {
            const staffDisplayName = await getStaffDisplayName(userId)
            await bot.api.sendMessage(transaction.userId, `🤖 <b>${staffDisplayName}:</b> ${messageText}`, {
              parse_mode: "HTML",
            })

            await ctx.reply(
              `📤 <b>Message sent to customer</b>\n\n` +
                `Order: <code>#${session.currentOrderId}</code>\n` +
                `Message: "${messageText}"`,
              {
                parse_mode: "HTML",
                reply_markup: new InlineKeyboard()
                  .text("🔚 End Chat", `view_${session.currentOrderId}`)
                  .text("👀 View Order", `view_${session.currentOrderId}`),
              },
            )
          }
          return
        }

        // Handle regular customer messages and other flows...
        // [Include the rest of your customer message handling here]

        // Default fallback
        if (await canHandleCustomers(userId)) {
          await showEnhancedAdminPanel(ctx)
        } else {
          await ctx.reply("🤔 I didn't understand that. Please use the menu buttons or type /start to begin.")
        }
      } catch (error) {
        console.error("Error in text handler:", error)
        await ctx.reply("❌ Sorry, there was an error processing your message. Please try again.")
      }
    })

    // ===========================================
    // ADMIN COMMANDS
    // ===========================================

    bot.command("addadmin", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await isAdmin(userId))) {
          await ctx.reply("❌ Only admins can add new admins.")
          return
        }

        const args = ctx.match?.trim().split(" ")
        if (!args || args.length < 2) {
          await ctx.reply("❌ Usage: /addadmin [user_id] [name]")
          return
        }

        const newAdminId = args[0]
        const adminName = args.slice(1).join(" ")
        const botDisplayName = generateBotName()

        await db.collection("admins").doc(newAdminId).set({
          id: newAdminId,
          role: "admin",
          name: adminName,
          displayName: botDisplayName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ <b>ADMIN ADDED SUCCESSFULLY!</b>\n\n` +
            `👤 Name: <b>${adminName}</b>\n` +
            `🤖 Bot Display Name: <b>${botDisplayName}</b>\n` +
            `🆔 User ID: <code>${newAdminId}</code>\n` +
            `👑 Role: <b>Admin</b>\n\n` +
            `They can now manage orders and customer service.`,
          { parse_mode: "HTML" },
        )

        // Notify new admin
        try {
          await bot.api.sendMessage(
            newAdminId,
            `🎉 <b>WELCOME TO THE TEAM!</b>\n\n` +
              `You have been added as an Admin for Vintage & Crap Coin Store!\n\n` +
              `🤖 Your agent name: <b>${botDisplayName}</b>\n` +
              `(Customers will see you as this bot name)\n\n` +
              `🏪 <b>You can now:</b>\n` +
              `• Manage customer orders\n` +
              `• Handle customer support\n` +
              `• Add customer service reps\n\n` +
              `💬 Type /start to access the admin panel.`,
            { parse_mode: "HTML" },
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
        const botDisplayName = generateBotName()

        await db.collection("customerCare").doc(newCareId).set({
          id: newCareId,
          name: careName,
          displayName: botDisplayName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ <b>CUSTOMER SERVICE REP ADDED!</b>\n\n` +
            `👤 Name: <b>${careName}</b>\n` +
            `🤖 Bot Display Name: <b>${botDisplayName}</b>\n` +
            `🆔 User ID: <code>${newCareId}</code>\n` +
            `👥 Role: <b>Customer Service</b>\n\n` +
            `They can now handle customer orders and support.`,
          { parse_mode: "HTML" },
        )

        // Notify new customer service rep
        try {
          await bot.api.sendMessage(
            newCareId,
            `🎉 <b>WELCOME TO THE TEAM!</b>\n\n` +
              `You have been added as a Customer Service Representative for Vintage & Crap Coin Store!\n\n` +
              `🤖 Your agent name: <b>${botDisplayName}</b>\n` +
              `(Customers will see you as this bot name)\n\n` +
              `🏪 <b>You can now:</b>\n` +
              `• Handle customer orders\n` +
              `• Provide customer support\n` +
              `• Process transactions\n\n` +
              `💬 Type /start to access the customer service panel.`,
            { parse_mode: "HTML" },
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

    // Error handling
    bot.catch((err) => {
      console.error("❌ Bot error:", err)
    })

    console.log("✅ Enhanced Vintage & Crap Coin Store Bot initialized successfully!")
    console.log("👑 Super Admin IDs:", Array.from(SUPER_ADMIN_IDS))
    console.log("🔔 Notification Bot:", notificationBot ? "Enabled" : "Disabled")
  } catch (error) {
    console.error("❌ Error setting up enhanced bot:", error)
  }
}

// Initialize enhanced bot
setupEnhancedBot().catch((err) => {
  console.error("❌ Error setting up enhanced bot:", err)
})

// Express routes
app.get("/", async (req, res) => {
  try {
    const transactionsSnapshot = await db.collection("transactions").get()
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()
    const adminsSnapshot = await db.collection("admins").get()
    const careSnapshot = await db.collection("customerCare").get()

    res.json({
      status: "🏪 Enhanced Vintage & Crap Coin Store is running",
      timestamp: new Date().toISOString(),
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasNotificationBot: !!process.env.NOTIFICATION_BOT_TOKEN,
      hasFirebase: !!process.env.FIREBASE_PROJECT_ID,
      features: [
        "✅ Enhanced Staff Interface with Clickable Buttons",
        "✅ No More Typing Order IDs - Everything is Clickable",
        "✅ Separate Notification Bot Support",
        "✅ Inline Keyboards for Easy Navigation",
        "✅ Quick Order Taking with One Click",
        "✅ Enhanced Chat System",
        "✅ Real-time Order Management",
        "✅ Professional Staff Panel",
        "✅ Reduced Notification Spam",
        "✅ Better User Experience for Staff",
      ],
      improvements: [
        "🎯 One-click order taking",
        "📱 Mobile-friendly inline keyboards",
        "🔔 Optional separate notification bot",
        "💬 Enhanced chat system",
        "📋 Visual order management",
        "⚡ Faster staff workflow",
        "🎨 Better UI/UX design",
        "🔧 No command typing required",
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
      status: "🏪 Enhanced Vintage & Crap Coin Store is running",
      timestamp: new Date().toISOString(),
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasNotificationBot: !!process.env.NOTIFICATION_BOT_TOKEN,
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
  console.log(`🚀 Enhanced Vintage & Crap Coin Store server running on port ${PORT}`)
  console.log("🏪 Enhanced bot with clickable interface is ready!")
  console.log("📊 Visit the URL to see bot statistics")
  console.log("💡 Key improvements:")
  console.log("   • No more typing order IDs")
  console.log("   • Everything is clickable")
  console.log("   • Better staff experience")
  console.log("   • Reduced notification spam")
  console.log("   • Optional separate notification bot")
})
