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

// SUPER ADMIN IDs - REPLACE WITH YOUR ACTUAL TELEGRAM USER IDs
const SUPER_ADMIN_IDS = new Set(["7763673217", "7477411555"]) // Replace with your IDs

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

// Create notification bot instance (if token provided)
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

// Session management
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

// Staff management functions
async function getUserRoleFromFirestore(userId) {
  try {
    if (!userId) return null

    if (isSuperAdmin(userId)) {
      const adminDoc = await db.collection("admins").doc(userId.toString()).get()
      if (adminDoc.exists) {
        return { type: "super_admin", data: adminDoc.data() }
      }
    }

    const adminDoc = await db.collection("admins").doc(userId.toString()).get()
    if (adminDoc.exists) {
      return { type: "admin", data: adminDoc.data() }
    }

    const careDoc = await db.collection("customerCare").doc(userId.toString()).get()
    if (careDoc.exists) {
      return { type: "customer_care", data: careDoc.data() }
    }

    return null
  } catch (error) {
    console.error(`Error checking user role for ${userId}:`, error)
    return null
  }
}

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
    return userRole !== null
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

// Initialize super admins
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
    console.log("✅ Super admins initialized")
  } catch (error) {
    console.error("Error initializing super admins:", error)
  }
}

// 🔔 ENHANCED NOTIFICATION SYSTEM WITH ERROR HANDLING
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

    // Choose which bot to use for notifications
    const botToUse = notificationBot || bot

    let successCount = 0
    let failureCount = 0

    // Send to all staff with error handling
    for (const staffId of allStaff) {
      try {
        await botToUse.api.sendMessage(staffId, message, {
          reply_markup: keyboard,
          parse_mode: "HTML",
        })
        successCount++
        console.log(`✅ Notification sent to staff ${staffId}`)
      } catch (error) {
        failureCount++
        console.error(`❌ Failed to notify staff ${staffId}:`, error.description || error.message)

        // If chat not found, remove from staff list
        if (error.description && error.description.includes("chat not found")) {
          console.log(`🗑️ Removing inactive staff member ${staffId} from notifications`)
          // You could optionally remove them from the database here
          // await removeInactiveStaff(staffId)
        }
      }
    }

    console.log(`📢 Notification results: ${successCount} sent, ${failureCount} failed`)
  } catch (error) {
    console.error("Error sending staff notification:", error)
  }
}

// Enhanced admin panel
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
    console.error("Error showing admin panel:", error)
    await ctx.reply("❌ Sorry, there was an error loading the admin panel.")
  }
}

// Show orders with clickable actions
async function showOrdersWithActions(ctx, page = 0) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) return

    const ordersSnapshot = await db.collection("transactions").where("status", "==", "pending").get()

    if (ordersSnapshot.empty) {
      const keyboard = new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel")
      await ctx.reply(
        "📋 <b>PENDING ORDERS</b>\n\nNo pending orders at the moment.\n\nNew orders will appear here automatically.",
        {
          reply_markup: keyboard,
          parse_mode: "HTML",
        },
      )
      return
    }

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
    console.error("Error showing orders:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Show order details
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
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Take order function
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

    // Create or update chat session
    await db.collection("chatSessions").doc(orderId).set(
      {
        orderId: orderId,
        userId: transaction.userId,
        staffId: userId,
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    const staffInfo = await getStaffInfo(userId)
    const staffDisplayName = await getStaffDisplayName(userId)
    const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

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

    // Notify customer
    await bot.api.sendMessage(
      transaction.userId,
      `🤖 <b>AGENT ASSIGNED!</b>\n\n` +
        `${staffDisplayName} has been assigned to your order <code>#${orderId}</code>!\n\n` +
        `They will assist you with your ${transaction.type} of ${amountDisplay} ${transaction.symbol}.`,
      { parse_mode: "HTML" },
    )

    console.log(`✅ Order ${orderId} assigned to staff ${staffInfo}`)
  } catch (error) {
    console.error("Error taking order:", error)
    await ctx.reply("❌ Sorry, there was an error taking the order.")
  }
}

// Complete order function
async function completeOrder(ctx, orderId) {
  try {
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
  } catch (error) {
    console.error("Error completing order:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Cancel order function
async function cancelOrder(ctx, orderId) {
  try {
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
      status: "cancelled",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Update chat session
    await db.collection("chatSessions").doc(orderId).update({
      status: "cancelled",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

    await ctx.reply(
      `❌ <b>ORDER CANCELLED</b>\n\n` +
        `🆔 Order ID: <code>#${orderId}</code>\n` +
        `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n` +
        `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n\n` +
        `Order has been cancelled.`,
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
      `❌ <b>TRANSACTION CANCELLED</b>\n\n` +
        `🆔 Order ID: <code>#${orderId}</code>\n` +
        `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n` +
        `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n\n` +
        `Your transaction has been cancelled.\n` +
        `💬 Type /start to make a new transaction.`,
      { parse_mode: "HTML" },
    )

    console.log(`❌ Order ${orderId} cancelled by staff ${await getStaffInfo(userId)}`)
  } catch (error) {
    console.error("Error cancelling order:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// FIXED: Show active chats function
async function showActiveChats(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      console.log(`❌ User ${userId} not authorized for active chats`)
      return
    }

    console.log(`🔍 Fetching active chats for staff ${userId}`)

    // Get active chat sessions
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

    console.log(`📊 Found ${activeChatsSnapshot.size} active chat sessions`)

    if (activeChatsSnapshot.empty) {
      console.log("📭 No active chats found")
      await ctx.reply(
        "💬 <b>ACTIVE CHATS</b>\n\nNo active chats at the moment.\n\nActive conversations will appear here.",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
        },
      )
      return
    }

    let chatsList = "💬 <b>ACTIVE CHATS</b>\n\n"
    const keyboard = new InlineKeyboard()
    let validChats = 0

    for (const chatDoc of activeChatsSnapshot.docs) {
      const chat = chatDoc.data()
      console.log(`📋 Processing chat session:`, { orderId: chat.orderId, userId: chat.userId, staffId: chat.staffId })

      try {
        // Get transaction details
        const orderDoc = await db.collection("transactions").doc(chat.orderId).get()

        if (!orderDoc.exists) {
          console.log(`⚠️ Transaction ${chat.orderId} not found for chat session`)
          continue
        }

        const order = orderDoc.data()
        console.log(`📦 Found order:`, { id: order.id, type: order.type, symbol: order.symbol, status: order.status })

        if (order) {
          validChats++
          const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`
          const timeAgo = getTimeAgo(chat.createdAt?.toDate?.())

          // Get customer info
          let customerInfo = "Unknown"
          try {
            const customerDoc = await db.collection("users").doc(order.userId.toString()).get()
            if (customerDoc.exists) {
              const customer = customerDoc.data()
              customerInfo = customer?.username
                ? `@${customer.username}`
                : customer?.first_name || `User ${order.userId}`
            } else {
              customerInfo = `User ${order.userId}`
            }
          } catch (error) {
            console.error(`Error getting customer info for ${order.userId}:`, error)
            customerInfo = `User ${order.userId}`
          }

          // Get staff info
          let staffInfo = "Unassigned"
          if (chat.staffId) {
            try {
              staffInfo = await getStaffDisplayName(chat.staffId)
            } catch (error) {
              console.error(`Error getting staff info for ${chat.staffId}:`, error)
              staffInfo = `Staff ${chat.staffId}`
            }
          }

          chatsList += `🆔 Order <code>#${chat.orderId.slice(-8)}</code>\n`
          chatsList += `🪙 ${order.type.toUpperCase()} ${amountDisplay} ${order.symbol}\n`
          chatsList += `👤 Customer: ${customerInfo}\n`
          chatsList += `👨‍💼 Staff: ${staffInfo}\n`
          chatsList += `⏰ Started: ${timeAgo}\n\n`

          keyboard
            .text(`💬 Chat #${chat.orderId.slice(-4)}`, `chat_${chat.orderId}`)
            .text(`👀 View #${chat.orderId.slice(-4)}`, `view_${chat.orderId}`)
            .row()
        }
      } catch (error) {
        console.error(`Error processing chat session ${chatDoc.id}:`, error)
      }
    }

    if (validChats === 0) {
      console.log("📭 No valid active chats found after processing")
      await ctx.reply(
        "💬 <b>ACTIVE CHATS</b>\n\nNo valid active chats found.\n\nActive conversations will appear here.",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
        },
      )
      return
    }

    keyboard.text("🔄 Refresh", "view_chats").text("🔙 Back to Panel", "back_to_panel")

    await ctx.reply(chatsList, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    })

    console.log(`✅ Displayed ${validChats} active chats to staff ${userId}`)
  } catch (error) {
    console.error("Error showing active chats:", error)
    await ctx.reply("❌ Sorry, there was an error loading active chats. Please try again.")
  }
}

// Show staff management
async function showStaffManagement(ctx) {
  try {
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
        staffList += `• ${admin.name} (${admin.role}) - ID: <code>${adminDoc.id}</code>\n`
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
        staffList += `• ${care.name} - ID: <code>${careDoc.id}</code>\n`
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
  } catch (error) {
    console.error("Error showing staff management:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Show statistics
async function showStatistics(ctx) {
  try {
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
  } catch (error) {
    console.error("Error showing statistics:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// 🛍️ CUSTOMER EXPERIENCE FUNCTIONS

// Show customer main menu
async function showCustomerMainMenu(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    await setUserSession(userId, { step: "main_menu", isStaff: false })

    await ctx.reply(
      "🏪 <b>VINTAGE & CRAP COIN STORE</b>\n\n" +
        "Your quirky shop for all things crypto - from vintage gems to the latest crap coins! 💎💩\n\n" +
        "🔥 Fast • Fun • Reliable\n\n" +
        "What would you like to do today?",
      {
        parse_mode: "HTML",
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
  } catch (error) {
    console.error("Error showing customer main menu:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Show available tokens
async function showAvailableTokens(ctx) {
  try {
    let tokenList = "📋 <b>AVAILABLE CRYPTOCURRENCIES</b>\n\n"

    AVAILABLE_TOKENS.forEach((token, index) => {
      tokenList += `<b>${index + 1}. ${token.name} (${token.symbol})</b>\n`
      tokenList += `   📍 Contract: <code>${token.contractAddress}</code>\n\n`
    })

    tokenList += "💡 You can also trade custom tokens using contract addresses!"

    await ctx.reply(tokenList, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: "🔙 Back to Menu" }]],
        resize_keyboard: true,
      },
    })
  } catch (error) {
    console.error("Error showing available tokens:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Show customer transactions
async function showCustomerTransactions(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const userTransactionsSnapshot = await db.collection("transactions").where("userId", "==", userId).get()

    if (userTransactionsSnapshot.empty) {
      await ctx.reply(
        "📊 <b>YOUR TRANSACTIONS</b>\n\n" +
          "You have no transactions yet.\n\n" +
          "Start trading by selecting Buy or Sell!",
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Menu" }]],
            resize_keyboard: true,
          },
        },
      )
      return
    }

    // Sort by createdAt and limit to 10
    const sortedDocs = userTransactionsSnapshot.docs
      .sort((a, b) => {
        const aTime = a.data().createdAt?.toDate?.() || new Date(0)
        const bTime = b.data().createdAt?.toDate?.() || new Date(0)
        return bTime - aTime
      })
      .slice(0, 10)

    let transactionList = "📊 <b>YOUR RECENT TRANSACTIONS</b>\n\n"
    const transactionButtons = []

    sortedDocs.forEach((doc, index) => {
      const tx = doc.data()
      const statusEmoji =
        {
          pending: "⏳ Processing",
          waiting_payment: "💳 Awaiting Payment",
          waiting_tokens: "📤 Awaiting Tokens",
          payment_sent: "🔄 Payment Verification",
          tokens_sent: "✅ Tokens Sent",
          in_progress: "🔄 Processing",
          completed: "✅ Completed",
          cancelled: "❌ Cancelled",
        }[tx.status] || "❓ Unknown"

      const amountDisplay = tx.type === "buy" ? `$${tx.amount} USD worth of` : `${tx.amount}`

      transactionList += `<b>${index + 1}. ${tx.type.toUpperCase()} ${amountDisplay} ${tx.symbol}</b>\n`
      transactionList += `   🆔 ID: <code>#${tx.id}</code>\n`
      transactionList += `   📊 Status: ${statusEmoji}\n`
      transactionList += `   📅 Date: ${tx.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}\n\n`

      transactionButtons.push([{ text: `📋 Manage #${tx.id.slice(-6)}` }])
    })

    transactionButtons.push([{ text: "🔄 Refresh" }, { text: "🔙 Back to Menu" }])

    await ctx.reply(transactionList, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: transactionButtons,
        resize_keyboard: true,
      },
    })
  } catch (error) {
    console.error("Error showing customer transactions:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Show customer help
async function showCustomerHelp(ctx) {
  try {
    const helpText =
      "❓ <b>HELP & SUPPORT</b>\n\n" +
      "🔹 <b>How to Buy Crypto:</b>\n" +
      "1️⃣ Select 'Buy Crypto'\n" +
      "2️⃣ Choose your token\n" +
      "3️⃣ Enter amount to buy\n" +
      "4️⃣ Make payment to provided address\n" +
      "5️⃣ Submit transaction hash\n" +
      "6️⃣ Receive your tokens\n\n" +
      "🔹 <b>How to Sell Crypto:</b>\n" +
      "1️⃣ Select 'Sell Crypto'\n" +
      "2️⃣ Choose your token\n" +
      "3️⃣ Enter amount to sell\n" +
      "4️⃣ Send tokens to provided address\n" +
      "5️⃣ Receive payment confirmation\n\n" +
      "🔹 <b>Security:</b>\n" +
      "• All transactions are verified on BSC\n" +
      "• Never share private keys\n" +
      "• Double-check all addresses\n\n" +
      "🔹 <b>Support:</b>\n" +
      "Our team is available 24/7 to assist you!"

    await ctx.reply(helpText, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: "🔙 Back to Menu" }]],
        resize_keyboard: true,
      },
    })
  } catch (error) {
    console.error("Error showing customer help:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Handle transaction type selection (Buy/Sell)
async function handleTransactionType(ctx, type) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    session.transactionType = type
    session.step = "select_token"
    await setUserSession(userId, session)

    const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
    tokenButtons.push([{ text: "🔍 Custom Token (Contract Address)" }])
    tokenButtons.push([{ text: "🔙 Back to Menu" }])

    await ctx.reply(`💼 <b>${type.toUpperCase()} CRYPTOCURRENCY</b>\n\n` + `Select the token you want to ${type}:`, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: tokenButtons,
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    })

    console.log(`📝 User ${getUserInfo(ctx)} selected ${type}`)
  } catch (error) {
    console.error(`Error in ${type} crypto:`, error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Handle token selection
async function handleTokenSelection(ctx, selectedText) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (session.step !== "select_token") return

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
        `💰 <b>AMOUNT ENTRY</b>\n\n` +
        `${amountText} of ${selectedToken.symbol} would you like to ${actionText}?\n\n` +
        `📝 Please enter the amount:`,
      {
        parse_mode: "HTML",
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
}

// Handle amount entry
async function handleAmountEntry(ctx, messageText) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (session.step !== "enter_amount") return

    if (!isValidAmount(messageText)) {
      await ctx.reply(
        "❌ Invalid amount. Please enter a valid number.\n\n" + "📝 Example: 100 (for $100 USD or 100 tokens)",
      )
      return
    }

    session.amount = messageText
    session.step = "confirm_transaction"
    await setUserSession(userId, session)

    const amountDisplay = session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`
    const tokenInfo = session.contractAddress ? `\n📍 Contract: <code>${session.contractAddress}</code>` : ""

    await ctx.reply(
      `📋 <b>TRANSACTION CONFIRMATION</b>\n\n` +
        `🔄 Action: <b>${session.transactionType?.toUpperCase()}</b>\n` +
        `🪙 Token: <b>${session.symbol}</b> (${session.coin})\n` +
        `💰 Amount: <b>${amountDisplay} ${session.symbol}</b>${tokenInfo}\n\n` +
        `⚠️ Please review your transaction details carefully.\n\n` +
        `Do you want to proceed?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "✅ Confirm Transaction" }, { text: "❌ Cancel Transaction" }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error handling amount entry:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Handle custom contract address
async function handleCustomContract(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    session.step = "custom_contract"
    await setUserSession(userId, session)

    await ctx.reply(
      "🔍 <b>CUSTOM TOKEN</b>\n\n" +
        "Please send the contract address of the token you want to trade:\n\n" +
        "📝 Example: <code>0x1234567890abcdef1234567890abcdef12345678</code>",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Token List" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error handling custom contract:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Handle custom contract address input
async function handleCustomContractInput(ctx, messageText) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (session.step !== "custom_contract") return

    const contractAddress = messageText.trim()

    if (!isValidContractAddress(contractAddress)) {
      await ctx.reply(
        "❌ Invalid contract address format!\n\n" +
          "Please provide a valid Ethereum contract address starting with 0x followed by 40 hexadecimal characters.\n\n" +
          "📝 Example: <code>0x1234567890abcdef1234567890abcdef12345678</code>",
        { parse_mode: "HTML" },
      )
      return
    }

    // Check if it's a known token
    const knownToken = findTokenByContract(contractAddress)

    let tokenInfo
    let tokenName
    let tokenSymbol

    if (knownToken) {
      tokenInfo = getTokenDisplayInfo(knownToken)
      tokenName = knownToken.name
      tokenSymbol = knownToken.symbol
    } else {
      tokenInfo = `📋 <b>Custom Token Information:</b>
🏷️ Name: Unknown Token
🔤 Symbol: Unknown
📍 Contract: <code>${contractAddress}</code>

⚠️ This is a custom token not in our predefined list.`
      tokenName = `Custom Token (${contractAddress.substring(0, 8)}...)`
      tokenSymbol = "CUSTOM"
    }

    session.coin = tokenName
    session.symbol = tokenSymbol
    session.contractAddress = contractAddress
    session.step = "enter_amount"
    await setUserSession(userId, session)

    const actionText = session.transactionType === "buy" ? "purchase" : "sell"
    const amountText = session.transactionType === "buy" ? "How much USD worth" : "How many tokens"

    await ctx.reply(
      `${tokenInfo}\n\n` +
        `💰 <b>AMOUNT ENTRY</b>\n\n` +
        `${amountText} of this token would you like to ${actionText}?\n\n` +
        `📝 Please enter the amount:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Token List" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error handling custom contract input:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

// Setup notification bot (if enabled)
async function setupNotificationBot() {
  if (!notificationBot) {
    console.log("⚠️ Notification bot disabled - no token provided")
    return
  }

  try {
    await notificationBot.init()

    // Handle callback queries for notification bot
    notificationBot.on("callback_query:data", async (ctx) => {
      try {
        const data = ctx.callbackQuery.data
        const userId = ctx.from?.id

        if (!userId) return
        await ctx.answerCallbackQuery()

        if (data.startsWith("take_")) {
          const orderId = data.substring(5)
          await handleQuickTake(ctx, orderId, userId)
        } else if (data.startsWith("view_")) {
          const orderId = data.substring(5)
          await showQuickOrderView(ctx, orderId)
        } else if (data === "view_all_orders") {
          await showAllOrdersQuick(ctx)
        }
      } catch (error) {
        console.error("Error handling notification callback:", error)
      }
    })

    // Quick take from notification
    async function handleQuickTake(ctx, orderId, userId) {
      try {
        // Check if user is staff
        const userRole = await getUserRoleFromFirestore(userId)
        if (!userRole) {
          await ctx.reply("❌ You are not authorized to take orders.")
          return
        }

        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found or already taken.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.status !== "pending") {
          await ctx.reply("❌ This order is no longer available.")
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
        const amountDisplay =
          transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

        await ctx.reply(
          `✅ <b>ORDER TAKEN SUCCESSFULLY!</b>\n\n` +
            `🆔 Order ID: <code>#${orderId}</code>\n` +
            `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n` +
            `🪙 Token: <b>${transaction.symbol}</b>\n` +
            `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n\n` +
            `🎯 Go to the main bot to continue processing this order.`,
          { parse_mode: "HTML" },
        )

        // Notify customer
        await bot.api.sendMessage(
          transaction.userId,
          `🤖 <b>AGENT ASSIGNED!</b>\n\n` +
            `${staffDisplayName} has been assigned to your order <code>#${orderId}</code>!\n\n` +
            `They will assist you with your ${transaction.type} of ${amountDisplay} ${transaction.symbol}.`,
          { parse_mode: "HTML" },
        )

        console.log(`✅ Order ${orderId} taken via notification bot by ${userId}`)
      } catch (error) {
        console.error("Error in quick take:", error)
        await ctx.reply("❌ Sorry, there was an error taking the order.")
      }
    }

    // Quick order view
    async function showQuickOrderView(ctx, orderId) {
      try {
        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found.")
          return
        }

        const transaction = transactionDoc.data()
        const amountDisplay =
          transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`

        let detailsText = `📋 <b>QUICK ORDER VIEW</b>\n\n`
        detailsText += `🆔 Order ID: <code>#${orderId}</code>\n`
        detailsText += `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n`
        detailsText += `🪙 Token: <b>${transaction.symbol}</b>\n`
        detailsText += `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n`
        detailsText += `👤 Customer: ${transaction.userId}\n`
        detailsText += `📊 Status: <b>${transaction.status}</b>\n`

        const keyboard = new InlineKeyboard()

        if (transaction.status === "pending") {
          keyboard.text("🎯 Take Order", `take_${orderId}`)
        }

        keyboard.text("📋 View All Orders", "view_all_orders")

        await ctx.reply(detailsText, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })
      } catch (error) {
        console.error("Error showing quick order view:", error)
        await ctx.reply("❌ Sorry, there was an error.")
      }
    }

    // Show all orders quick view
    async function showAllOrdersQuick(ctx) {
      try {
        const ordersSnapshot = await db.collection("transactions").where("status", "==", "pending").get()

        if (ordersSnapshot.empty) {
          await ctx.reply("📋 No pending orders at the moment.")
          return
        }

        const sortedDocs = ordersSnapshot.docs
          .sort((a, b) => {
            const aTime = a.data().createdAt?.toDate?.() || new Date(0)
            const bTime = b.data().createdAt?.toDate?.() || new Date(0)
            return bTime - aTime
          })
          .slice(0, 5) // Show only first 5

        let ordersList = `📋 <b>PENDING ORDERS</b>\n\n`
        const keyboard = new InlineKeyboard()

        sortedDocs.forEach((doc, index) => {
          const order = doc.data()
          const amountDisplay = order.type === "buy" ? `$${order.amount} USD` : `${order.amount}`

          ordersList += `<b>${index + 1}.</b> ${order.type.toUpperCase()} ${amountDisplay} ${order.symbol}\n`
          ordersList += `   🆔 <code>#${order.id}</code>\n\n`

          keyboard
            .text(`🎯 Take #${order.id.slice(-4)}`, `take_${order.id}`)
            .text(`👀 View #${order.id.slice(-4)}`, `view_${order.id}`)
            .row()
        })

        await ctx.reply(ordersList, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        })
      } catch (error) {
        console.error("Error showing all orders quick:", error)
        await ctx.reply("❌ Sorry, there was an error.")
      }
    }

    notificationBot.command("start", async (ctx) => {
      await ctx.reply(
        "🔔 <b>NOTIFICATION BOT</b>\n\n" +
          "This bot is for staff notifications only.\n\n" +
          "You'll receive order notifications here with quick action buttons.\n\n" +
          "Use the main bot for full order management.",
        { parse_mode: "HTML" },
      )
    })

    console.log("✅ Notification bot initialized successfully!")
  } catch (error) {
    console.error("❌ Error setting up notification bot:", error)
  }
}

// Setup main bot
async function setupBot() {
  try {
    await bot.init()
    await initializeSuperAdmins()

    // Setup notification bot if enabled
    await setupNotificationBot()

    // Handle callback queries (button clicks)
    bot.on("callback_query:data", async (ctx) => {
      try {
        const data = ctx.callbackQuery.data
        const userId = ctx.from?.id

        if (!userId) return
        await ctx.answerCallbackQuery()

        console.log(`🔘 Callback query received: ${data} from user ${userId}`)

        // Route to appropriate handler
        if (data === "view_orders") {
          console.log("📋 Routing to view orders")
          await showOrdersWithActions(ctx)
        } else if (data === "view_chats") {
          console.log("💬 Routing to view chats")
          await showActiveChats(ctx)
        } else if (data === "view_stats") {
          console.log("📊 Routing to view statistics")
          await showStatistics(ctx)
        } else if (data === "manage_staff") {
          console.log("👥 Routing to manage staff")
          await showStaffManagement(ctx)
        } else if (data === "staff_help") {
          console.log("❓ Routing to staff help")
          await ctx.reply(
            "❓ <b>STAFF HELP GUIDE</b>\n\n" +
              "🎯 <b>Taking Orders:</b>\n" +
              "• Click 'View Orders' to see pending orders\n" +
              "• Click '🎯 Take' button next to any order\n" +
              "• No need to type order IDs!\n\n" +
              "💳 <b>Processing Orders:</b>\n" +
              "• After taking order, use action buttons\n" +
              "• Click 'Send Payment Address' for buy orders\n" +
              "• Click 'Send Wallet Address' for sell orders\n" +
              "• Complete orders when done\n\n" +
              "💬 <b>Customer Chat:</b>\n" +
              "• Click 'Chat Customer' to start chatting\n" +
              "• Type messages normally - they're auto-forwarded\n\n" +
              "🔔 <b>Notifications:</b>\n" +
              `• ${notificationBot ? "Separate notification bot enabled" : "Notifications in main bot"}\n` +
              "• Quick actions available in notifications\n" +
              "• Take orders directly from notifications",
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
            },
          )
        } else if (data === "back_to_panel") {
          console.log("🔙 Routing back to panel")
          await showEnhancedAdminPanel(ctx)
        } else if (data.startsWith("orders_page_")) {
          const page = Number.parseInt(data.split("_")[2])
          console.log(`📄 Routing to orders page ${page}`)
          await showOrdersWithActions(ctx, page)
        } else if (data.startsWith("take_")) {
          const orderId = data.substring(5)
          console.log(`🎯 Routing to take order ${orderId}`)
          await takeOrder(ctx, orderId)
        } else if (data.startsWith("view_")) {
          const orderId = data.substring(5)
          console.log(`👀 Routing to view order ${orderId}`)
          await showOrderDetails(ctx, orderId)
        } else if (data.startsWith("payment_")) {
          const orderId = data.substring(8)
          console.log(`💳 Routing to payment address for ${orderId}`)
          await handlePaymentAddress(ctx, orderId)
        } else if (data.startsWith("wallet_")) {
          const orderId = data.substring(7)
          console.log(`📤 Routing to wallet address for ${orderId}`)
          await handleWalletAddress(ctx, orderId)
        } else if (data.startsWith("complete_")) {
          const orderId = data.substring(9)
          console.log(`✅ Routing to complete order ${orderId}`)
          await completeOrder(ctx, orderId)
        } else if (data.startsWith("cancel_")) {
          const orderId = data.substring(7)
          console.log(`❌ Routing to cancel order ${orderId}`)
          await cancelOrder(ctx, orderId)
        } else if (data.startsWith("chat_")) {
          const orderId = data.substring(5)
          console.log(`💬 Routing to chat for order ${orderId}`)
          await startChatWithCustomer(ctx, orderId)
        } else {
          console.log(`❓ Unknown callback query: ${data}`)
          await ctx.reply("❌ Unknown action. Please try again.")
        }
      } catch (error) {
        console.error("Error handling callback:", error)
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

    // Start command
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

        await showCustomerMainMenu(ctx)
        console.log(`✅ Regular user ${getUserInfo(ctx)} started the bot`)
      } catch (error) {
        console.error("Error in start command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Customer button handlers
    bot.hears("💰 Buy Crypto", async (ctx) => {
      await handleTransactionType(ctx, "buy")
    })

    bot.hears("💱 Sell Crypto", async (ctx) => {
      await handleTransactionType(ctx, "sell")
    })

    bot.hears("📋 Available Tokens", async (ctx) => {
      await showAvailableTokens(ctx)
    })

    bot.hears("📊 My Transactions", async (ctx) => {
      await showCustomerTransactions(ctx)
    })

    bot.hears("❓ Help & Support", async (ctx) => {
      await showCustomerHelp(ctx)
    })

    bot.hears("🔙 Back to Menu", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      const isStaff = await canHandleCustomers(userId)
      if (isStaff) {
        await showEnhancedAdminPanel(ctx)
      } else {
        await showCustomerMainMenu(ctx)
      }
    })

    bot.hears("🔙 Back to Token List", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (!session.transactionType) {
        await showCustomerMainMenu(ctx)
        return
      }

      session.step = "select_token"
      await setUserSession(userId, session)

      const tokenButtons = AVAILABLE_TOKENS.map((token) => [{ text: `${token.symbol} - ${token.name}` }])
      tokenButtons.push([{ text: "🔍 Custom Token (Contract Address)" }])
      tokenButtons.push([{ text: "🔙 Back to Menu" }])

      await ctx.reply(
        `💼 <b>${session.transactionType.toUpperCase()} CRYPTOCURRENCY</b>\n\n` +
          `Select the token you want to ${session.transactionType}:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: tokenButtons,
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )
    })

    bot.hears("🔍 Custom Token (Contract Address)", async (ctx) => {
      await handleCustomContract(ctx)
    })

    // Token selection from list
    bot.hears(/^[A-Z]+ - /, async (ctx) => {
      const messageText = ctx.message?.text
      if (messageText) {
        await handleTokenSelection(ctx, messageText)
      }
    })

    // Customer transaction confirmation
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

        // Create chat session
        await db.collection("chatSessions").doc(orderId).set({
          orderId: orderId,
          userId: userId,
          staffId: null,
          status: "waiting_for_staff",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        const amountDisplay =
          session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`

        await ctx.reply(
          `✅ <b>ORDER CREATED SUCCESSFULLY!</b>\n\n` +
            `🆔 Transaction ID: <code>#${orderId}</code>\n` +
            `🔄 Action: <b>${session.transactionType?.toUpperCase()}</b>\n` +
            `🪙 Token: <b>${session.symbol}</b>\n` +
            `💰 Amount: <b>${amountDisplay} ${session.symbol}</b>\n\n` +
            `🔄 Your order is now in our processing queue.\n` +
            `⏱️ Expected processing time: 2-10 minutes\n\n` +
            `🤖 An automated agent will be assigned shortly.`,
          {
            parse_mode: "HTML",
            reply_markup: {
              keyboard: [[{ text: "📊 My Transactions" }, { text: "🔄 New Transaction" }]],
              resize_keyboard: true,
            },
          },
        )

        // Reset session
        await setUserSession(userId, { step: "main_menu", isStaff: false })

        // 🔔 SEND STAFF NOTIFICATION
        const userInfo = getUserInfo(ctx)
        const tokenInfo = session.contractAddress ? `\n📍 Contract: ${session.contractAddress}` : ""

        await sendStaffNotification(
          `🚨 <b>NEW ${session.transactionType?.toUpperCase()} ORDER!</b>\n\n` +
            `👤 Customer: ${userInfo}\n` +
            `🪙 Token: ${session.symbol} (${session.coin})\n` +
            `💰 Amount: ${amountDisplay} ${session.symbol}${tokenInfo}\n` +
            `🆔 Order ID: <code>#${orderId}</code>\n\n` +
            `💼 Click below to handle this order`,
          orderId,
          "high",
        )

        console.log(`✅ Order ${orderId} created for user ${getUserInfo(ctx)}`)
      } catch (error) {
        console.error("Error in transaction confirmation:", error)
        await ctx.reply("❌ Sorry, there was an error processing your transaction. Please try again.")
      }
    })

    bot.hears("❌ Cancel Transaction", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      await setUserSession(userId, { step: "main_menu", isStaff: false })
      await ctx.reply("❌ <b>Transaction Cancelled</b>\n\nWhat would you like to do?", {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [
            [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
            [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
            [{ text: "❓ Help & Support" }],
          ],
          resize_keyboard: true,
        },
      })
    })

    bot.hears("🔄 New Transaction", async (ctx) => {
      await showCustomerMainMenu(ctx)
    })

    bot.hears("🔄 Refresh", async (ctx) => {
      await showCustomerTransactions(ctx)
    })

    // Handle transaction management buttons
    bot.hears(/^📋 Manage #/, async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        const messageText = ctx.message?.text || ""
        const orderIdPart = messageText.replace("📋 Manage #", "")

        // Find the full order ID
        const userTransactionsSnapshot = await db.collection("transactions").where("userId", "==", userId).get()
        let orderId = null

        for (const doc of userTransactionsSnapshot.docs) {
          if (doc.id.includes(orderIdPart)) {
            orderId = doc.id
            break
          }
        }

        if (!orderId) {
          await ctx.reply("❌ Transaction not found.")
          return
        }

        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Transaction not found.")
          return
        }

        const transaction = transactionDoc.data()
        const amountDisplay =
          transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`
        const statusEmoji =
          {
            pending: "⏳ Processing",
            waiting_payment: "💳 Awaiting Payment",
            waiting_tokens: "📤 Awaiting Tokens",
            payment_sent: "🔄 Payment Verification",
            tokens_sent: "✅ Tokens Sent",
            in_progress: "🔄 Processing",
            completed: "✅ Completed",
            cancelled: "❌ Cancelled",
          }[transaction.status] || "❓ Unknown"

        let basicInfo = `📋 <b>ORDER SUMMARY</b>\n\n`
        basicInfo += `🆔 Order ID: <code>#${orderId}</code>\n`
        basicInfo += `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n`
        basicInfo += `🪙 Token: <b>${transaction.symbol}</b>\n`
        basicInfo += `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n`
        basicInfo += `📊 Status: ${statusEmoji}\n`
        basicInfo += `📅 Created: ${transaction.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}`

        await ctx.reply(basicInfo, { parse_mode: "HTML" })

        // Show additional details if available
        let additionalInfo = ""

        if (transaction.contractAddress) {
          additionalInfo += `📍 Contract: <code>${transaction.contractAddress}</code>\n`
        }

        if (transaction.assignedStaff) {
          const staffDisplayName = await getStaffDisplayName(transaction.assignedStaff)
          additionalInfo += `🤖 Assigned Agent: ${staffDisplayName}\n`
        }

        if (transaction.paymentAddress) {
          additionalInfo += `💳 Payment Address: <code>${transaction.paymentAddress}</code>\n`
        }

        if (transaction.receivingAddress) {
          additionalInfo += `📤 Receiving Address: <code>${transaction.receivingAddress}</code>\n`
        }

        if (transaction.customerTxHash) {
          additionalInfo += `📝 Your TX Hash: <code>${transaction.customerTxHash}</code>\n`
        }

        if (transaction.sentTxHash) {
          additionalInfo += `✅ Sent TX Hash: <code>${transaction.sentTxHash}</code>\n`
        }

        if (additionalInfo) {
          await ctx.reply(`📋 <b>ADDITIONAL DETAILS</b>\n\n${additionalInfo}`, { parse_mode: "HTML" })
        }

        // Show status-specific instructions
        let instructions = ""
        const actionButtons = []

        switch (transaction.status) {
          case "pending":
            instructions = "⏳ Your order is being processed. An agent will be assigned soon."
            break
          case "waiting_payment":
            if (transaction.paymentAddress) {
              instructions = `💳 <b>PAYMENT REQUIRED</b>\n\nSend payment to: <code>${transaction.paymentAddress}</code>\n\nAfter payment, submit your transaction hash.`
              actionButtons.push([{ text: "📝 Submit Payment Hash" }])
            }
            break
          case "waiting_tokens":
            if (transaction.receivingAddress) {
              instructions = `📤 <b>SEND TOKENS</b>\n\nSend tokens to: <code>${transaction.receivingAddress}</code>\n\nAfter sending, submit your transaction hash.`
              actionButtons.push([{ text: "📝 Submit Transaction Hash" }])
            }
            break
          case "payment_sent":
            instructions = "🔄 Your payment is being verified. Please wait for confirmation."
            break
          case "tokens_sent":
            instructions = "🔄 Your tokens are being verified. Payment will be sent once confirmed."
            break
          case "in_progress":
            instructions = "🔄 Your order is being processed by our agent."
            actionButtons.push([{ text: "💬 Chat with Support" }])
            break
          case "completed":
            instructions = "✅ Your transaction has been completed successfully!"
            break
          case "cancelled":
            instructions = "❌ This transaction has been cancelled."
            break
          default:
            instructions = "❓ Status unknown. Please contact support."
            actionButtons.push([{ text: "💬 Chat with Support" }])
        }

        if (instructions) {
          await ctx.reply(instructions, { parse_mode: "HTML" })
        }

        // Add common action buttons
        if (["in_progress", "payment_sent", "tokens_sent"].includes(transaction.status)) {
          actionButtons.push([{ text: "💬 Chat with Support" }])
        }

        actionButtons.push([{ text: "🔄 Refresh Status" }])
        actionButtons.push([{ text: "📊 Back to Transactions" }, { text: "🔙 Back to Menu" }])

        // Store current transaction in session for follow-up actions
        const session = await getUserSession(userId)
        session.currentTransactionId = orderId
        await setUserSession(userId, session)

        await ctx.reply("What would you like to do?", {
          reply_markup: {
            keyboard: actionButtons,
            resize_keyboard: true,
          },
        })
      } catch (error) {
        console.error("Error showing transaction details:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Handle transaction hash submission buttons
    bot.hears("📝 Submit Payment Hash", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (!session.currentTransactionId) {
        await ctx.reply("❌ No transaction selected. Please go back to your transactions.")
        return
      }

      session.step = "enter_payment_hash"
      await setUserSession(userId, session)

      await ctx.reply(
        "📝 <b>SUBMIT PAYMENT HASH</b>\n\n" +
          "Please provide your payment transaction hash for verification.\n\n" +
          "📋 Example:\n" +
          "<code>0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef</code>\n\n" +
          "⚠️ Make sure the hash is correct!",
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "📊 Back to Transactions" }]],
            resize_keyboard: true,
          },
        },
      )
    })

    bot.hears("📝 Submit Transaction Hash", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (!session.currentTransactionId) {
        await ctx.reply("❌ No transaction selected. Please go back to your transactions.")
        return
      }

      session.step = "enter_token_hash"
      await setUserSession(userId, session)

      await ctx.reply(
        "📝 <b>SUBMIT TRANSACTION HASH</b>\n\n" +
          "Please provide your token sending transaction hash for verification.\n\n" +
          "📋 Example:\n" +
          "<code>0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef</code>\n\n" +
          "⚠️ Make sure the hash is correct!",
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "📊 Back to Transactions" }]],
            resize_keyboard: true,
          },
        },
      )
    })

    bot.hears("💬 Chat with Support", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (!session.currentTransactionId) {
        await ctx.reply("❌ No transaction selected. Please go back to your transactions.")
        return
      }

      session.step = "chat_with_support"
      session.orderId = session.currentTransactionId
      await setUserSession(userId, session)

      await ctx.reply(
        "💬 <b>CHAT WITH SUPPORT</b>\n\n" +
          `You are now connected to support for order <code>#${session.currentTransactionId}</code>.\n\n` +
          "Type your message and it will be forwarded to our support team.\n\n" +
          "💡 You can ask questions about your order status, payment, or any issues.",
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "📊 Back to Transactions" }, { text: "🔙 Back to Menu" }]],
            resize_keyboard: true,
          },
        },
      )
    })

    bot.hears("🔄 Refresh Status", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      const session = await getUserSession(userId)
      if (!session.currentTransactionId) {
        await ctx.reply("❌ No transaction selected. Please go back to your transactions.")
        return
      }

      // Trigger the manage transaction display again
      const orderId = session.currentTransactionId
      const orderIdPart = orderId.slice(-6)

      // Simulate the manage button click
      ctx.message.text = `📋 Manage #${orderIdPart}`

      // Find and call the manage handler
      const manageHandlers = bot.handlers.filter(
        (h) => h.trigger && h.trigger.test && h.trigger.test(`📋 Manage #${orderIdPart}`),
      )

      if (manageHandlers.length > 0) {
        await manageHandlers[0].middleware(ctx)
      } else {
        await ctx.reply("🔄 Status refreshed! Please check your transaction details.")
        await showCustomerTransactions(ctx)
      }
    })

    bot.hears("📊 Back to Transactions", async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      // Clear current transaction from session
      const session = await getUserSession(userId)
      delete session.currentTransactionId
      session.step = "main_menu"
      await setUserSession(userId, session)

      await showCustomerTransactions(ctx)
    })

    // Admin commands
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

    // Enhanced remove staff command
    bot.command("removestaff", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId || !(await isAdmin(userId))) {
          await ctx.reply("❌ Only admins can remove staff members.")
          return
        }

        const staffId = ctx.match?.trim()
        if (!staffId) {
          await ctx.reply("❌ Usage: /removestaff [user_id]")
          return
        }

        // Prevent removing super admins
        if (isSuperAdmin(staffId)) {
          await ctx.reply("❌ Cannot remove super admin.")
          return
        }

        let removed = false
        let staffInfo = ""

        // Check if admin
        const adminDoc = await db.collection("admins").doc(staffId).get()
        if (adminDoc.exists) {
          const admin = adminDoc.data()
          staffInfo = `Admin ${admin.name}`
          await db.collection("admins").doc(staffId).delete()
          removed = true
        }

        // Check if customer care
        if (!removed) {
          const careDoc = await db.collection("customerCare").doc(staffId).get()
          if (careDoc.exists) {
            const care = careDoc.data()
            staffInfo = `Customer service rep ${care.name}`
            await db.collection("customerCare").doc(staffId).delete()
            removed = true
          }
        }

        if (removed) {
          await ctx.reply(
            `✅ <b>STAFF MEMBER REMOVED</b>\n\n` +
              `${staffInfo} (ID: <code>${staffId}</code>) has been removed from the team.`,
            { parse_mode: "HTML" },
          )

          // Notify removed staff member
          try {
            await bot.api.sendMessage(
              staffId,
              `📢 <b>ACCESS REVOKED</b>\n\n` +
                `Your staff access to Vintage & Crap Coin Store has been revoked.\n\n` +
                `If you believe this is an error, please contact an administrator.`,
              { parse_mode: "HTML" },
            )
          } catch (error) {
            console.log(`Could not notify removed staff member ${staffId}`)
          }

          console.log(`✅ ${staffInfo} (${staffId}) removed by ${userId}`)
        } else {
          await ctx.reply("❌ Staff member not found.")
        }
      } catch (error) {
        console.error("Error in removestaff command:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Text message handler
    bot.on("message:text", async (ctx) => {
      try {
        const userId = ctx.from?.id
        const messageText = ctx.message?.text
        if (!userId || !messageText) return

        const session = await getUserSession(userId)
        const isStaff = await canHandleCustomers(userId)

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

        // Handle customer flows
        if (!isStaff) {
          // Handle amount entry
          if (session.step === "enter_amount") {
            await handleAmountEntry(ctx, messageText)
            return
          }

          // Handle custom contract address entry
          if (session.step === "custom_contract") {
            await handleCustomContractInput(ctx, messageText)
            return
          }

          // Handle payment hash entry
          if (session.step === "enter_payment_hash") {
            if (!isValidTxHash(messageText)) {
              await ctx.reply(
                "❌ Invalid transaction hash format!\n\n" +
                  "Please provide a valid transaction hash starting with 0x followed by 64 hexadecimal characters.\n\n" +
                  "📝 Example: <code>0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef</code>",
                { parse_mode: "HTML" },
              )
              return
            }

            // Update transaction with hash
            if (session.currentTransactionId) {
              await db.collection("transactions").doc(session.currentTransactionId).update({
                customerTxHash: messageText,
                status: "payment_sent",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              })

              // Notify staff
              const transactionDoc = await db.collection("transactions").doc(session.currentTransactionId).get()
              const transaction = transactionDoc.data()

              if (transaction && transaction.assignedStaff) {
                await bot.api.sendMessage(
                  transaction.assignedStaff,
                  `💳 <b>PAYMENT HASH RECEIVED!</b>\n\n` +
                    `🆔 Order ID: <code>#${session.currentTransactionId}</code>\n` +
                    `📝 Transaction Hash: <code>${messageText}</code>\n` +
                    `🔍 Verify on BSCScan: https://bscscan.com/tx/${messageText}\n\n` +
                    `Please verify the payment and proceed with the order.`,
                  { parse_mode: "HTML" },
                )
              }

              // Notify customer
              await ctx.reply(
                `✅ <b>PAYMENT HASH SUBMITTED</b>\n\n` +
                  `📝 Hash: <code>${messageText}</code>\n` +
                  `🔍 Verify: https://bscscan.com/tx/${messageText}\n\n` +
                  `Your payment hash has been submitted and our team is verifying it.\n\n` +
                  `You'll be notified once the payment is confirmed.`,
                {
                  parse_mode: "HTML",
                  reply_markup: {
                    keyboard: [[{ text: "📊 Back to Transactions" }, { text: "🔙 Back to Menu" }]],
                    resize_keyboard: true,
                  },
                },
              )

              session.step = "main_menu"
              await setUserSession(userId, session)
            }
            return
          }

          // Handle token hash entry
          if (session.step === "enter_token_hash") {
            if (!isValidTxHash(messageText)) {
              await ctx.reply(
                "❌ Invalid transaction hash format!\n\n" +
                  "Please provide a valid transaction hash starting with 0x followed by 64 hexadecimal characters.\n\n" +
                  "📝 Example: <code>0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef</code>",
                { parse_mode: "HTML" },
              )
              return
            }

            // Update transaction with hash
            if (session.currentTransactionId) {
              await db.collection("transactions").doc(session.currentTransactionId).update({
                customerTxHash: messageText,
                status: "tokens_sent",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              })

              // Notify staff
              const transactionDoc = await db.collection("transactions").doc(session.currentTransactionId).get()
              const transaction = transactionDoc.data()

              if (transaction && transaction.assignedStaff) {
                await bot.api.sendMessage(
                  transaction.assignedStaff,
                  `📤 <b>TOKENS HASH RECEIVED!</b>\n\n` +
                    `🆔 Order ID: <code>#${session.currentTransactionId}</code>\n` +
                    `📝 Transaction Hash: <code>${messageText}</code>\n` +
                    `🔍 Verify on BSCScan: https://bscscan.com/tx/${messageText}\n\n` +
                    `Please verify the tokens received and proceed with payment.`,
                  { parse_mode: "HTML" },
                )
              }

              // Notify customer
              await ctx.reply(
                `✅ <b>TRANSACTION HASH SUBMITTED</b>\n\n` +
                  `📝 Hash: <code>${messageText}</code>\n` +
                  `🔍 Verify: https://bscscan.com/tx/${messageText}\n\n` +
                  `Your transaction hash has been submitted and our team is verifying it.\n\n` +
                  `You'll receive payment once the tokens are confirmed.`,
                {
                  parse_mode: "HTML",
                  reply_markup: {
                    keyboard: [[{ text: "📊 Back to Transactions" }, { text: "🔙 Back to Menu" }]],
                    resize_keyboard: true,
                  },
                },
              )

              session.step = "main_menu"
              await setUserSession(userId, session)
            }
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
                `💬 <b>Customer message (Order #${session.orderId}):</b>\n\n"${messageText}"\n\n` +
                  `Reply directly to chat with the customer.`,
                { parse_mode: "HTML" },
              )
            } else {
              // Notify all staff if no one assigned
              const adminsSnapshot = await db.collection("admins").get()
              const careSnapshot = await db.collection("customerCare").get()

              const staffNotification = `💬 <b>Customer message (Order #${session.orderId}):</b>\n\n"${messageText}"\n\nUse /take ${session.orderId} to handle this order.`

              for (const adminDoc of adminsSnapshot.docs) {
                try {
                  await bot.api.sendMessage(adminDoc.id, staffNotification, { parse_mode: "HTML" })
                } catch (error) {
                  console.error(`Error notifying admin ${adminDoc.id}:`, error)
                }
              }

              for (const careDoc of careSnapshot.docs) {
                try {
                  await bot.api.sendMessage(careDoc.id, staffNotification, { parse_mode: "HTML" })
                } catch (error) {
                  console.error(`Error notifying care rep ${careDoc.id}:`, error)
                }
              }
            }

            await ctx.reply("📤 Your message has been sent to our team. Please wait for a response.")
            return
          }

          // Default fallback for customers
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
        } else {
          // Staff member - show admin panel
          await showEnhancedAdminPanel(ctx)
        }
      } catch (error) {
        console.error("Error in text handler:", error)
        await ctx.reply("❌ Sorry, there was an error processing your message. Please try again.")
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

// Initialize bot
setupBot().catch((err) => {
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
        "✅ Complete Enhanced Customer Experience",
        "✅ Full Admin Panel with All Functions",
        "✅ Working Remove Staff Function",
        "✅ FIXED Active Chats Display",
        "✅ Enhanced Error Handling for Notifications",
        "✅ Seamless User Interface",
        "✅ Clickable Order Management",
        "✅ Integrated Notification System",
        "✅ Transaction Hash Submission",
        "✅ Real-time Chat Support",
        "✅ Professional Staff Management",
        "✅ Complete Customer Journey",
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
      status: "🏪 Enhanced bot running",
      timestamp: new Date().toISOString(),
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasNotificationBot: !!process.env.NOTIFICATION_BOT_TOKEN,
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

// Webhook for notification bot (if enabled)
app.post("/notification-webhook", async (req, res) => {
  try {
    if (notificationBot) {
      await notificationBot.handleUpdate(req.body)
    }
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("❌ Notification webhook error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Vintage & Crap Coin Store server running on port ${PORT}`)
  console.log("🏪 Complete enhanced bot with full customer & admin experience is ready!")
  console.log("📊 Visit the URL to see bot statistics")
  console.log("💡 Complete features:")
  console.log("   • ✅ Enhanced customer experience")
  console.log("   • ✅ Complete admin panel")
  console.log("   • ✅ Working remove staff function")
  console.log("   • ✅ FIXED Active chats display")
  console.log("   • ✅ Enhanced notification error handling")
  console.log("   • ✅ Seamless user interface")
  console.log("   • ✅ Professional transaction management")
  console.log("   • ✅ Integrated notification system")
  console.log("   • ✅ Transaction Hash Submission")
  console.log("   • ✅ Real-time Chat Support")
})
