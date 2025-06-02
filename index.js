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

// Add these functions after the showOrdersWithActions function

// Show orders categorized by type (buy/sell)
async function showCategorizedOrders(ctx, type = null, page = 0) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) return

    // Build query based on type filter
    let query = db.collection("transactions").where("status", "==", "pending")

    // If type is specified, filter by type
    if (type && (type === "buy" || type === "sell")) {
      query = db.collection("transactions").where("status", "==", "pending").where("type", "==", type)
    }

    const ordersSnapshot = await query.get()

    if (ordersSnapshot.empty) {
      const keyboard = new InlineKeyboard()
        .text("🔙 Back to Panel", "back_to_panel")
        .text("💰 Buy Orders", "buy_orders")
        .text("💱 Sell Orders", "sell_orders")

      const title = type ? `📋 <b>PENDING ${type.toUpperCase()} ORDERS</b>` : "📋 <b>PENDING ORDERS</b>"

      await ctx.reply(
        `${title}\n\nNo pending ${type || ""} orders at the moment.\n\nNew orders will appear here automatically.`,
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

    const title = type ? `📋 <b>PENDING ${type.toUpperCase()} ORDERS</b>` : "📋 <b>PENDING ORDERS</b>"
    let ordersList = `${title} (Page ${page + 1})\n\n`
    const keyboard = new InlineKeyboard()

    pageOrders.forEach((doc, index) => {
      const order = doc.data()
      const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`
      const timeAgo = getTimeAgo(order.createdAt?.toDate?.())
      const orderType = order.type === "buy" ? "💰 BUY" : "💱 SELL"

      ordersList += `<b>${startIndex + index + 1}.</b> ${orderType} ${amountDisplay} ${order.symbol}\n`
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
      keyboard.text("⬅️ Previous", `${type ? type + "_" : ""}orders_page_${page - 1}`)
    }
    if (endIndex < sortedDocs.length) {
      keyboard.text("➡️ Next", `${type ? type + "_" : ""}orders_page_${page + 1}`)
    }
    if (page > 0 || endIndex < sortedDocs.length) {
      keyboard.row()
    }

    // Filter buttons
    keyboard
      .text("🔄 Refresh", type ? `${type}_orders` : "view_orders")
      .text("🔙 Back to Panel", "back_to_panel")
      .row()

    if (!type) {
      keyboard.text("💰 Buy Orders", "buy_orders").text("💱 Sell Orders", "sell_orders")
    } else {
      keyboard.text("📋 All Orders", "view_orders")
    }

    await ctx.reply(ordersList, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    })
  } catch (error) {
    console.error("Error showing categorized orders:", error)
    await ctx.reply("❌ Sorry, there was an error.")
  }
}

// Show staff-specific active chats
async function showStaffActiveChats(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      console.log(`❌ User ${userId} not authorized for active chats`)
      return
    }

    console.log(`🔍 Fetching active chats for staff ${userId}`)

    // Get active chat sessions assigned to this staff member
    const activeChatsSnapshot = await db
      .collection("chatSessions")
      .where("status", "==", "active")
      .where("staffId", "==", userId)
      .get()

    console.log(`📊 Found ${activeChatsSnapshot.size} active chat sessions for staff ${userId}`)

    if (activeChatsSnapshot.empty) {
      console.log("📭 No active chats found for this staff")
      await ctx.reply(
        "💬 <b>YOUR ACTIVE CHATS</b>\n\nYou have no active chats at the moment.\n\nOrders you take will appear here.",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
        },
      )
      return
    }

    let chatsList = "💬 <b>YOUR ACTIVE CHATS</b>\n\n"
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
          const orderType = order.type === "buy" ? "💰 BUY" : "💱 SELL"

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

          chatsList += `🆔 ${orderType} <code>#${chat.orderId.slice(-8)}</code>\n`
          chatsList += `🪙 ${order.symbol} - ${amountDisplay}\n`
          chatsList += `👤 Customer: ${customerInfo}\n`
          chatsList += `📊 Status: <b>${order.status}</b>\n`
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
        "💬 <b>YOUR ACTIVE CHATS</b>\n\nNo valid active chats found.\n\nOrders you take will appear here.",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
        },
      )
      return
    }

    keyboard.text("🔄 Refresh", "my_chats").text("🔙 Back to Panel", "back_to_panel")

    await ctx.reply(chatsList, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    })

    console.log(`✅ Displayed ${validChats} active chats to staff ${userId}`)
  } catch (error) {
    console.error("Error showing staff active chats:", error)
    await ctx.reply("❌ Sorry, there was an error loading your active chats. Please try again.")
  }
}

// Admin function to view all staff and their assigned orders
async function showStaffOverview(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply("❌ Only admins can view staff overview.")
      return
    }

    // Get all staff members
    const adminsSnapshot = await db.collection("admins").get()
    const careSnapshot = await db.collection("customerCare").get()

    const allStaff = []

    // Process admins
    for (const adminDoc of adminsSnapshot.docs) {
      const admin = adminDoc.data()
      allStaff.push({
        id: adminDoc.id,
        name: admin.name || "Unknown Admin",
        displayName: admin.displayName || "AdminBot",
        role: admin.role || "admin",
        type: "admin",
      })
    }

    // Process customer care
    for (const careDoc of careSnapshot.docs) {
      const care = careDoc.data()
      allStaff.push({
        id: careDoc.id,
        name: care.name || "Unknown Staff",
        displayName: care.displayName || "SupportBot",
        role: "customer_care",
        type: "customer_care",
      })
    }

    // Get all active chats
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

    // Count active chats per staff
    const staffChatCounts = {}
    for (const chatDoc of activeChatsSnapshot.docs) {
      const chat = chatDoc.data()
      if (chat.staffId) {
        staffChatCounts[chat.staffId] = (staffChatCounts[chat.staffId] || 0) + 1
      }
    }

    // Build overview message
    let overviewText = "👥 <b>STAFF OVERVIEW</b>\n\n"

    // Group by role
    const superAdmins = allStaff.filter((staff) => staff.role === "super_admin")
    const admins = allStaff.filter((staff) => staff.role === "admin" && staff.role !== "super_admin")
    const customerCare = allStaff.filter((staff) => staff.type === "customer_care")

    // Add super admins
    if (superAdmins.length > 0) {
      overviewText += "👑 <b>SUPER ADMINS:</b>\n"
      for (const admin of superAdmins) {
        const chatCount = staffChatCounts[admin.id] || 0
        overviewText += `• ${admin.name} (${admin.displayName}) - <b>${chatCount}</b> active chats\n`
      }
      overviewText += "\n"
    }

    // Add regular admins
    if (admins.length > 0) {
      overviewText += "🔑 <b>ADMINS:</b>\n"
      for (const admin of admins) {
        const chatCount = staffChatCounts[admin.id] || 0
        overviewText += `• ${admin.name} (${admin.displayName}) - <b>${chatCount}</b> active chats\n`
      }
      overviewText += "\n"
    }

    // Add customer care
    if (customerCare.length > 0) {
      overviewText += "🛎️ <b>CUSTOMER SERVICE:</b>\n"
      for (const care of customerCare) {
        const chatCount = staffChatCounts[care.id] || 0
        overviewText += `• ${care.name} (${care.displayName}) - <b>${chatCount}</b> active chats\n`
      }
      overviewText += "\n"
    }

    // Add action buttons
    const keyboard = new InlineKeyboard()
      .text("👁️ View All Chats", "view_all_staff_chats")
      .text("🔙 Back to Panel", "back_to_panel")

    await ctx.reply(overviewText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error showing staff overview:", error)
    await ctx.reply("❌ Sorry, there was an error loading the staff overview.")
  }
}

// Admin function to view all active chats across all staff
async function viewAllStaffChats(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply("❌ Only admins can view all staff chats.")
      return
    }

    // Get all active chats
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

    if (activeChatsSnapshot.empty) {
      await ctx.reply("💬 <b>ALL ACTIVE CHATS</b>\n\nNo active chats found across all staff members.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Back to Staff Overview", "staff_overview"),
      })
      return
    }

    let chatsList = "💬 <b>ALL ACTIVE CHATS</b>\n\n"
    const keyboard = new InlineKeyboard()
    let validChats = 0

    for (const chatDoc of activeChatsSnapshot.docs) {
      const chat = chatDoc.data()

      try {
        // Get transaction details
        const orderDoc = await db.collection("transactions").doc(chat.orderId).get()

        if (!orderDoc.exists) continue

        const order = orderDoc.data()
        if (!order) continue

        validChats++
        const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`
        const orderType = order.type === "buy" ? "💰 BUY" : "💱 SELL"

        // Get customer info
        let customerInfo = "Unknown"
        try {
          const customerDoc = await db.collection("users").doc(order.userId.toString()).get()
          if (customerDoc.exists) {
            const customer = customerDoc.data()
            customerInfo = customer?.username ? `@${customer.username}` : customer?.first_name || `User ${order.userId}`
          }
        } catch (error) {
          customerInfo = `User ${order.userId}`
        }

        // Get staff info
        let staffInfo = "Unassigned"
        if (chat.staffId) {
          try {
            const staffDisplayName = await getStaffDisplayName(chat.staffId)
            const staffName = await getStaffInfo(chat.staffId)
            staffInfo = `${staffDisplayName} (${staffName})`
          } catch (error) {
            staffInfo = `Staff ${chat.staffId}`
          }
        }

        chatsList += `🆔 ${orderType} <code>#${chat.orderId.slice(-8)}</code>\n`
        chatsList += `🪙 ${order.symbol} - ${amountDisplay}\n`
        chatsList += `👤 Customer: ${customerInfo}\n`
        chatsList += `👨‍💼 Staff: ${staffInfo}\n`
        chatsList += `📊 Status: <b>${order.status}</b>\n\n`

        keyboard
          .text(`👀 View #${chat.orderId.slice(-4)}`, `admin_view_${chat.orderId}`)
          .text(`💬 Take Over #${chat.orderId.slice(-4)}`, `admin_take_${chat.orderId}`)
          .row()
      } catch (error) {
        console.error(`Error processing chat session ${chatDoc.id}:`, error)
      }
    }

    if (validChats === 0) {
      await ctx.reply("💬 <b>ALL ACTIVE CHATS</b>\n\nNo valid active chats found across all staff members.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Back to Staff Overview", "staff_overview"),
      })
      return
    }

    keyboard.text("🔄 Refresh", "view_all_staff_chats").text("🔙 Back to Staff Overview", "staff_overview")

    await ctx.reply(chatsList, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error viewing all staff chats:", error)
    await ctx.reply("❌ Sorry, there was an error loading all staff chats.")
  }
}

// Admin function to take over a chat from another staff member
async function adminTakeOverChat(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply("❌ Only admins can take over chats.")
      return
    }

    // Get the chat session
    const chatDoc = await db.collection("chatSessions").doc(orderId).get()
    if (!chatDoc.exists) {
      await ctx.reply("❌ Chat session not found.")
      return
    }

    const chat = chatDoc.data()
    const previousStaffId = chat.staffId

    // Get the transaction
    const transactionDoc = await db.collection("transactions").doc(orderId).get()
    if (!transactionDoc.exists) {
      await ctx.reply("❌ Transaction not found.")
      return
    }

    const transaction = transactionDoc.data()

    // Update the chat session and transaction
    await db.collection("chatSessions").doc(orderId).update({
      staffId: userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await db.collection("transactions").doc(orderId).update({
      assignedStaff: userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Add a system message to the chat
    await db.collection("messages").add({
      orderId: orderId,
      senderId: "system",
      senderType: "system",
      message: `Admin ${await getStaffInfo(userId)} has taken over this chat.`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Notify the customer
    const staffDisplayName = await getStaffDisplayName(userId)
    await bot.api.sendMessage(
      transaction.userId,
      `🔄 <b>STAFF CHANGE</b>\n\nAdmin ${staffDisplayName} has taken over your order <code>#${orderId}</code>.\n\nYou can continue chatting here.`,
      { parse_mode: "HTML" },
    )

    // Notify the previous staff member if there was one
    if (previousStaffId) {
      try {
        await bot.api.sendMessage(
          previousStaffId,
          `ℹ️ <b>CHAT REASSIGNED</b>\n\nAdmin ${await getStaffInfo(userId)} has taken over order <code>#${orderId}</code>.`,
          { parse_mode: "HTML" },
        )
      } catch (error) {
        console.error(`Error notifying previous staff ${previousStaffId}:`, error)
      }
    }

    // Confirm to the admin
    await ctx.reply(
      `✅ <b>CHAT TAKEOVER SUCCESSFUL</b>\n\nYou have taken over order <code>#${orderId}</code>.\n\nYou can now chat with the customer.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("💬 Chat Now", `chat_${orderId}`)
          .text("👀 View Order", `view_${orderId}`)
          .row()
          .text("🔙 Back to All Chats", "view_all_staff_chats"),
      },
    )
  } catch (error) {
    console.error("Error in admin take over chat:", error)
    await ctx.reply("❌ Sorry, there was an error taking over the chat.")
  }
}

// Modify the showEnhancedAdminPanel function to include the new buttons
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

    // Get active chats for this staff member
    const activeChatsSnapshot = await db
      .collection("chatSessions")
      .where("status", "==", "active")
      .where("staffId", "==", userId)
      .get()

    // Get buy and sell counts
    const buyOrdersSnapshot = await db
      .collection("transactions")
      .where("status", "==", "pending")
      .where("type", "==", "buy")
      .get()

    const sellOrdersSnapshot = await db
      .collection("transactions")
      .where("status", "==", "pending")
      .where("type", "==", "sell")
      .get()

    let panelText = `🏪 <b>STAFF CONTROL PANEL</b>\n\n`
    panelText += `👤 Welcome: <b>${staffInfo}</b>\n`
    panelText += `🤖 Your Agent Name: <b>${staffDisplayName}</b>\n`
    panelText += `📊 Pending Orders: <b>${pendingSnapshot.size}</b> (💰 Buy: ${buyOrdersSnapshot.size}, 💱 Sell: ${sellOrdersSnapshot.size})\n`
    panelText += `💬 Your Active Chats: <b>${activeChatsSnapshot.size}</b>\n\n`
    panelText += `Choose an action below:`

    const keyboard = new InlineKeyboard()
      .text("📋 All Orders", "view_orders")
      .text("💬 My Chats", "my_chats")
      .row()
      .text("💰 Buy Orders", "buy_orders")
      .text("💱 Sell Orders", "sell_orders")
      .row()

    if (await isAdmin(userId)) {
      keyboard
        .text("👥 Manage Staff", "manage_staff")
        .text("📊 Statistics", "view_stats")
        .row()
        .text("👁️ Staff Overview", "staff_overview")
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

// Update the callback query handler in the setupBot function to include the new routes
// Find the bot.on("callback_query:data") handler and replace it with this updated version:

bot.on("callback_query:data", async (ctx) => {
  try {
    const data = ctx.callbackQuery.data
    const userId = ctx.from?.id

    if (!userId) return
    await ctx.answerCallbackQuery()

    console.log(`🔘 Callback query received: ${data} from user ${userId}`)

    // Route to appropriate handler
    if (data === "view_orders") {
      console.log("📋 Routing to view all orders")
      await showOrdersWithActions(ctx)
    } else if (data === "buy_orders") {
      console.log("💰 Routing to view buy orders")
      await showCategorizedOrders(ctx, "buy")
    } else if (data === "sell_orders") {
      console.log("💱 Routing to view sell orders")
      await showCategorizedOrders(ctx, "sell")
    } else if (data === "my_chats") {
      console.log("💬 Routing to view staff's active chats")
      await showStaffActiveChats(ctx)
    } else if (data === "view_chats") {
      console.log("💬 Routing to view all active chats")
      await showActiveChats(ctx)
    } else if (data === "staff_overview") {
      console.log("👥 Routing to staff overview")
      await showStaffOverview(ctx)
    } else if (data === "view_all_staff_chats") {
      console.log("👁️ Routing to view all staff chats")
      await viewAllStaffChats(ctx)
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
          "• Click 'All Orders' to see all pending orders\n" +
          "• Click 'Buy Orders' or 'Sell Orders' to filter\n" +
          "• Click '🎯 Take' button next to any order\n" +
          "• Orders you take appear in 'My Chats'\n\n" +
          "💳 <b>Processing Orders:</b>\n" +
          "• After taking order, use action buttons\n" +
          "• Click 'Send Payment Address' for buy orders\n" +
          "• Click 'Send Wallet Address' for sell orders\n" +
          "• Complete orders when done\n\n" +
          "💬 <b>Customer Chat:</b>\n" +
          "• Click 'My Chats' to see your assigned chats\n" +
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
    } else if (data.startsWith("buy_orders_page_")) {
      const page = Number.parseInt(data.split("_")[3])
      console.log(`📄 Routing to buy orders page ${page}`)
      await showCategorizedOrders(ctx, "buy", page)
    } else if (data.startsWith("sell_orders_page_")) {
      const page = Number.parseInt(data.split("_")[3])
      console.log(`📄 Routing to sell orders page ${page}`)
      await showCategorizedOrders(ctx, "sell", page)
    } else if (data.startsWith("take_")) {
      const orderId = data.substring(5)
      console.log(`🎯 Routing to take order ${orderId}`)
      await takeOrder(ctx, orderId)
    } else if (data.startsWith("admin_take_")) {
      const orderId = data.substring(11)
      console.log(`👑 Routing to admin take over chat ${orderId}`)
      await adminTakeOverChat(ctx, orderId)
    } else if (data.startsWith("admin_view_") || data.startsWith("view_")) {
      const orderId = data.startsWith("admin_view_") ? data.substring(11) : data.substring(5)
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

    const amountDisplay = session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`

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
    const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`
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
} catch (error)
{
  console.error("❌ Error setting up enhanced bot:", error)
}
}

// Initialize bot
setupBot().catch((err) =>
{
  console.error("❌ Error setting up enhanced bot:", err)
}
)

// Express routes
app.get("/", async (req, res) =>
{
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
        \"✅ Complete Enhanced Customer Experience",
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
}
)

app.post("/webhook", async (req, res) =>
{
  try {
    await bot.handleUpdate(req.body)
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("❌ Webhook error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}
)

// Webhook for notification bot (if enabled)
app.post("/notification-webhook", async (req, res) =>
{
  try {
    if (notificationBot) {
      await notificationBot.handleUpdate(req.body)
    }
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("❌ Notification webhook error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}
)

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

async function handleTransactionType(ctx, type) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    await setUserSession(userId, {
      step: "select_token",
      transactionType: type,
    })

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
  } catch (error) {
    console.error("Error in handleTransactionType:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function showAvailableTokens(ctx) {
  try {
    let tokenList = "📋 <b>AVAILABLE TOKENS</b>\n\n"
    AVAILABLE_TOKENS.forEach((token) => {
      tokenList += `🪙 ${token.symbol} - ${token.name}\n`
      tokenList += `📍 Contract: <code>${token.contractAddress}</code>\n\n`
    })

    tokenList += "🔍 You can also add a custom token by contract address."

    await ctx.reply(tokenList, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: "🔙 Back to Menu" }]],
        resize_keyboard: true,
      },
    })
  } catch (error) {
    console.error("Error in showAvailableTokens:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function showCustomerTransactions(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const transactionsSnapshot = await db.collection("transactions").where("userId", "==", userId).get()

    if (transactionsSnapshot.empty) {
      await ctx.reply("📊 <b>MY TRANSACTIONS</b>\n\nNo transactions found.", {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔄 New Transaction" }, { text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      })
      return
    }

    let transactionsList = "📊 <b>MY TRANSACTIONS</b>\n\n"
    for (const doc of transactionsSnapshot.docs) {
      const transaction = doc.data()
      const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`
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

      transactionsList += `🆔 Order ID: <code>#${doc.id.slice(-6)}</code>\n`
      transactionsList += `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n`
      transactionsList += `🪙 Token: <b>${transaction.symbol}</b>\n`
      transactionsList += `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n`
      transactionsList += `📊 Status: ${statusEmoji}\n\n`
    }

    transactionsList += "📋 Click 'Manage' to view details and take action."

    await ctx.reply(transactionsList, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [
          [{ text: "📋 Manage #123456" }],
          [{ text: "🔄 Refresh" }, { text: "🔄 New Transaction" }],
          [{ text: "🔙 Back to Menu" }],
        ],
        resize_keyboard: true,
      },
    })
  } catch (error) {
    console.error("Error in showCustomerTransactions:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function showCustomerHelp(ctx) {
  try {
    await ctx.reply(
      "❓ <b>CUSTOMER HELP & SUPPORT</b>\n\n" +
        "💰 <b>Buying Crypto:</b>\n" +
        "• Select 'Buy Crypto' from the menu\n" +
        "• Choose the token you want to buy\n" +
        "• Enter the amount in USD\n" +
        "• Confirm the transaction\n\n" +
        "💱 <b>Selling Crypto:</b>\n" +
        "• Select 'Sell Crypto' from the menu\n" +
        "• Choose the token you want to sell\n" +
        "• Enter the amount of tokens\n" +
        "• Confirm the transaction\n\n" +
        "📋 <b>Available Tokens:</b>\n" +
        "• View the list of supported tokens\n" +
        "• Check the contract address\n\n" +
        "📊 <b>My Transactions:</b>\n" +
        "• Track your order status\n" +
        "• View transaction details\n" +
        "• Submit payment or token hashes\n\n" +
        "📞 <b>Contact Support:</b>\n" +
        "• If you have any questions or issues\n" +
        "• Use the 'Chat with Support' button\n\n" +
        "⚠️ <b>Important Notes:</b>\n" +
        "• Always double-check the contract address\n" +
        "• Send the exact amount specified\n" +
        "• Use the correct network (BSC)\n" +
        "• Submit your transaction hash after payment",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Menu" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error in showCustomerHelp:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function handleTransactionType(ctx, type) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    await setUserSession(userId, {
      step: "select_token",
      transactionType: type,
    })

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
  } catch (error) {
    console.error("Error in handleTransactionType:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function handleCustomContract(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (!session.transactionType) {
      await ctx.reply("Please start over with /start")
      return
    }

    session.step = "custom_contract"
    await setUserSession(userId, session)

    await ctx.reply(
      "📍 <b>ENTER CONTRACT ADDRESS</b>\n\n" +
        "Please enter the contract address of the token you want to trade.\n\n" +
        "📋 Example:\n" +
        "<code>0x1234567890abcdef1234567890abcdef12345678</code>",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Token List" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error in handleCustomContract:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function handleCustomContractInput(ctx, contractAddress) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (session.step !== "custom_contract") {
      await ctx.reply("Please start over with /start")
      return
    }

    if (!isValidContractAddress(contractAddress)) {
      await ctx.reply(
        "❌ Invalid contract address format!\n\n" +
          "Please provide a valid contract address starting with 0x followed by 40 hexadecimal characters.\n\n" +
          "📋 Example:\n" +
          "<code>0x1234567890abcdef1234567890abcdef12345678</code>",
        { parse_mode: "HTML" },
      )
      return
    }

    session.contractAddress = contractAddress
    session.step = "enter_amount"
    await setUserSession(userId, session)

    await ctx.reply(
      `💰 <b>ENTER AMOUNT</b>\n\n` +
        `You have selected a custom token with contract address:\n` +
        `<code>${contractAddress}</code>\n\n` +
        `Please enter the amount you want to ${session.transactionType}:\n\n` +
        `For <b>BUY</b>, enter the amount in USD (e.g., 100)\n` +
        `For <b>SELL</b>, enter the amount of tokens (e.g., 1.5)`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Token List" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error in handleCustomContractInput:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function handleTokenSelection(ctx, messageText) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (session.step !== "select_token") {
      await ctx.reply("Please start over with /start")
      return
    }

    const tokenInfo = messageText.split(" - ")
    const symbol = tokenInfo[0]
    const coin = tokenInfo[1]

    const selectedToken = AVAILABLE_TOKENS.find((token) => token.symbol === symbol && token.name === coin)

    if (!selectedToken) {
      await ctx.reply("❌ Invalid token selected. Please try again.")
      return
    }

    session.coin = coin
    session.symbol = symbol
    session.contractAddress = selectedToken.contractAddress
    session.step = "enter_amount"
    await setUserSession(userId, session)

    await ctx.reply(
      `💰 <b>ENTER AMOUNT</b>\n\n` +
        `You have selected <b>${symbol} - ${coin}</b>\n\n` +
        `Please enter the amount you want to ${session.transactionType}:\n\n` +
        `For <b>BUY</b>, enter the amount in USD (e.g., 100)\n` +
        `For <b>SELL</b>, enter the amount of tokens (e.g., 1.5)`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "🔙 Back to Token List" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error in handleTokenSelection:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function handleAmountEntry(ctx, amountText) {
  try {
    const userId = ctx.from?.id
    if (!userId) return

    const session = await getUserSession(userId)
    if (session.step !== "enter_amount") {
      await ctx.reply("Please start over with /start")
      return
    }

    const amount = Number.parseFloat(amountText)
    if (!isValidAmount(amount)) {
      await ctx.reply("❌ Invalid amount. Please enter a valid number greater than zero.")
      return
    }

    session.amount = amount
    session.step = "confirm_transaction"
    await setUserSession(userId, session)

    const amountDisplay = session.transactionType === "buy" ? `$${amount} USD worth of` : `${amount}`

    await ctx.reply(
      `✅ <b>CONFIRM TRANSACTION</b>\n\n` +
        `🔄 Action: <b>${session.transactionType?.toUpperCase()}</b>\n` +
        `🪙 Token: <b>${session.symbol}</b>\n` +
        `💰 Amount: <b>${amountDisplay} ${session.symbol}</b>\n\n` +
        `Please confirm that you want to proceed with this transaction.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "✅ Confirm Transaction" }, { text: "❌ Cancel Transaction" }]],
          resize_keyboard: true,
        },
      },
    )
  } catch (error) {
    console.error("Error in handleAmountEntry:", error)
    await ctx.reply("❌ Sorry, there was an error. Please try again.")
  }
}

async function showStatistics(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply("❌ Only admins can view statistics.")
      return
    }

    const transactionsSnapshot = await db.collection("transactions").get()
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()
    const adminsSnapshot = await db.collection("admins").get()
    const careSnapshot = await db.collection("customerCare").get()

    let statsText = "📊 <b>SYSTEM STATISTICS</b>\n\n"
    statsText += `Total Transactions: <b>${transactionsSnapshot.size}</b>\n`
    statsText += `Active Chats: <b>${activeChatsSnapshot.size}</b>\n`
    statsText += `Total Admins: <b>${adminsSnapshot.size}</b>\n`
    statsText += `Total Customer Service: <b>${careSnapshot.size}</b>\n\n`
    statsText += "📈 More detailed statistics coming soon!"

    await ctx.reply(statsText, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
    })
  } catch (error) {
    console.error("Error showing statistics:", error)
    await ctx.reply("❌ Sorry, there was an error loading the statistics.")
  }
}

async function showStaffManagement(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply("❌ Only admins can manage staff.")
      return
    }

    let staffManagementText = "👥 <b>STAFF MANAGEMENT</b>\n\n"
    staffManagementText += "Use the following commands to manage staff members:\n\n"
    staffManagementText += "• /addadmin [user_id] [name] - Add a new admin\n"
    staffManagementText += "• /addcare [user_id] [name] - Add a customer service rep\n"
    staffManagementText += "• /removestaff [user_id] - Remove a staff member\n\n"
    staffManagementText += "💡 Make sure to use the correct Telegram user ID."

    await ctx.reply(staffManagementText, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
    })
  } catch (error) {
    console.error("Error showing staff management:", error)
    await ctx.reply("❌ Sorry, there was an error loading the staff management panel.")
  }
}

async function takeOrder(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      await ctx.reply("❌ You are not authorized to take orders.")
      return
    }

    // Get the transaction
    const transactionDoc = await db.collection("transactions").doc(orderId).get()
    if (!transactionDoc.exists) {
      await ctx.reply("❌ Transaction not found.")
      return
    }

    const transaction = transactionDoc.data()

    // Check if the order is already taken
    if (transaction.assignedStaff) {
      await ctx.reply("❌ This order is already taken by another staff member.")
      return
    }

    // Update the transaction
    await db.collection("transactions").doc(orderId).update({
      assignedStaff: userId,
      status: "in_progress",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Update the chat session
    await db.collection("chatSessions").doc(orderId).update({
      staffId: userId,
      status: "active",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Notify the staff member
    const staffDisplayName = await getStaffDisplayName(userId)
    await ctx.reply(
      `✅ <b>ORDER TAKEN SUCCESSFULLY!</b>\n\n` +
        `You have taken order <code>#${orderId}</code>.\n\n` +
        `You can now chat with the customer and process the order.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("💬 Chat Customer", `chat_${orderId}`)
          .text("👀 View Order", `view_${orderId}`)
          .row()
          .text("📋 Back to Orders", "view_orders"),
      },
    )

    // Notify the customer
    await bot.api.sendMessage(
      transaction.userId,
      `🎉 <b>ORDER UPDATE</b>\n\n` +
        `Your order <code>#${orderId}</code> has been taken by <b>${staffDisplayName}</b>.\n\n` +
        `You can now chat with them to process your order.`,
      { parse_mode: "HTML" },
    )

    // Send staff notification
    await sendStaffNotification(
      `ℹ️ <b>ORDER TAKEN</b>\n\n` +
        `Order <code>#${orderId}</code> has been taken by ${staffDisplayName}.\n\n` +
        `No further action is required.`,
      null,
      "low",
    )
  } catch (error) {
    console.error("Error in takeOrder:", error)
    await ctx.reply("❌ Sorry, there was an error taking the order.")
  }
}

async function showOrderDetails(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      await ctx.reply("❌ You are not authorized to view order details.")
      return
    }

    // Get the transaction
    const transactionDoc = await db.collection("transactions").doc(orderId).get()
    if (!transactionDoc.exists) {
      await ctx.reply("❌ Transaction not found.")
      return
    }

    const transaction = transactionDoc.data()
    const amountDisplay = transaction.type === "buy" ? `$${transaction.amount} USD worth of` : `${transaction.amount}`
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

    let orderDetails = `📋 <b>ORDER DETAILS</b>\n\n`
    orderDetails += `🆔 Order ID: <code>#${orderId}</code>\n`
    orderDetails += `🔄 Action: <b>${transaction.type.toUpperCase()}</b>\n`
    orderDetails += `🪙 Token: <b>${transaction.symbol}</b>\n`
    orderDetails += `💰 Amount: <b>${amountDisplay} ${transaction.symbol}</b>\n`
    orderDetails += `📊 Status: ${statusEmoji}\n`
    orderDetails += `📅 Created: ${transaction.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}\n\n`

    if (transaction.contractAddress) {
      orderDetails += `📍 Contract: <code>${transaction.contractAddress}</code>\n`
    }

    if (transaction.assignedStaff) {
      const staffDisplayName = await getStaffDisplayName(transaction.assignedStaff)
      orderDetails += `🤖 Assigned Agent: ${staffDisplayName}\n`
    }

    if (transaction.paymentAddress) {
      orderDetails += `💳 Payment Address: <code>${transaction.paymentAddress}</code>\n`
    }

    if (transaction.receivingAddress) {
      orderDetails += `📤 Receiving Address: <code>${transaction.receivingAddress}</code>\n`
    }

    if (transaction.customerTxHash) {
      orderDetails += `📝 Customer TX Hash: <code>${transaction.customerTxHash}</code>\n`
    }

    if (transaction.sentTxHash) {
      orderDetails += `✅ Sent TX Hash: <code>${transaction.sentTxHash}</code>\n`
    }

    const keyboard = new InlineKeyboard()

    if (transaction.status === "in_progress") {
      keyboard
        .text("💬 Chat Customer", `chat_${orderId}`)
        .text("💳 Send Payment Address", `payment_${orderId}`)
        .text("📤 Send Wallet Address", `wallet_${orderId}`)
        .row()
        .text("✅ Complete Order", `complete_${orderId}`)
        .text("❌ Cancel Order", `cancel_${orderId}`)
    } else if (transaction.status === "waiting_payment") {
      keyboard.text("✅ Complete Order", `complete_${orderId}`).text("❌ Cancel Order", `cancel_${orderId}`)
    } else if (transaction.status === "waiting_tokens") {
      keyboard.text("✅ Complete Order", `complete_${orderId}`).text("❌ Cancel Order", `cancel_${orderId}`)
    } else {
      keyboard.text("📋 Back to Orders", "view_orders")
    }

    keyboard.row().text("🔙 Back to Panel", "back_to_panel")

    await ctx.reply(orderDetails, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    })
  } catch (error) {
    console.error("Error in showOrderDetails:", error)
    await ctx.reply("❌ Sorry, there was an error loading the order details.")
  }
}

async function completeOrder(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      await ctx.reply("❌ You are not authorized to complete orders.")
      return
    }

    // Get the transaction
    const transactionDoc = await db.collection("transactions").doc(orderId).get()
    if (!transactionDoc.exists) {
      await ctx.reply("❌ Transaction not found.")
      return
    }

    const transaction = transactionDoc.data()

    // Update the transaction
    await db.collection("transactions").doc(orderId).update({
      status: "completed",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Update the chat session
    await db.collection("chatSessions").doc(orderId).update({
      status: "completed",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Notify the staff member
    await ctx.reply(`✅ <b>ORDER COMPLETED SUCCESSFULLY!</b>\n\nOrder <code>#${orderId}</code> has been completed.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("📋 Back to Orders", "view_orders"),
    })

    // Notify the customer
    await bot.api.sendMessage(
      transaction.userId,
      `🎉 <b>ORDER COMPLETED</b>\n\nYour order <code>#${orderId}</code> has been completed successfully!`,
      { parse_mode: "HTML" },
    )

    // Send staff notification
    const staffDisplayName = await getStaffDisplayName(userId)
    await sendStaffNotification(
      `ℹ️ <b>ORDER COMPLETED</b>\n\nOrder <code>#${orderId}</code> has been completed by ${staffDisplayName}.\n\nNo further action is required.`,
      null,
      "low",
    )
  } catch (error) {
    console.error("Error in completeOrder:", error)
    await ctx.reply("❌ Sorry, there was an error completing the order.")
  }
}

async function cancelOrder(ctx, orderId) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      await ctx.reply("❌ You are not authorized to cancel orders.")
      return
    }

    // Get the transaction
    const transactionDoc = await db.collection("transactions").doc(orderId).get()
    if (!transactionDoc.exists) {
      await ctx.reply("❌ Transaction not found.")
      return
    }

    const transaction = transactionDoc.data()

    // Update the transaction
    await db.collection("transactions").doc(orderId).update({
      status: "cancelled",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Update the chat session
    await db.collection("chatSessions").doc(orderId).update({
      status: "cancelled",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Notify the staff member
    await ctx.reply(`❌ <b>ORDER CANCELLED</b>\n\nOrder <code>#${orderId}</code> has been cancelled.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("📋 Back to Orders", "view_orders"),
    })

    // Notify the customer
    await bot.api.sendMessage(
      transaction.userId,
      `📢 <b>ORDER CANCELLED</b>\n\nYour order <code>#${orderId}</code> has been cancelled. Please contact support for more information.`,
      { parse_mode: "HTML" },
    )

    // Send staff notification
    const staffDisplayName = await getStaffDisplayName(userId)
    await sendStaffNotification(
      `ℹ️ <b>ORDER CANCELLED</b>\n\nOrder <code>#${orderId}</code> has been cancelled by ${staffDisplayName}.\n\nPlease contact the customer for more information.`,
      null,
      "low",
    )
  } catch (error) {
    console.error("Error in cancelOrder:", error)
    await ctx.reply("❌ Sorry, there was an error cancelling the order.")
  }
}

async function showActiveChats(ctx) {
  try {
    const userId = ctx.from?.id
    if (!userId || !(await canHandleCustomers(userId))) {
      await ctx.reply("❌ You are not authorized to view active chats.")
      return
    }

    // Get active chat sessions
    const activeChatsSnapshot = await db.collection("chatSessions").where("status", "==", "active").get()

    if (activeChatsSnapshot.empty) {
      await ctx.reply("💬 <b>ACTIVE CHATS</b>\n\nNo active chats at the moment.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
      })
      return
    }

    let chatsList = "💬 <b>ACTIVE CHATS</b>\n\n"
    for (const doc of activeChatsSnapshot.docs) {
      const chat = doc.data()

      // Get transaction details
      const orderDoc = await db.collection("transactions").doc(chat.orderId).get()
      if (!orderDoc.exists) continue

      const order = orderDoc.data()
      if (!order) continue

      const amountDisplay = order.type === "buy" ? `$${order.amount} USD worth of` : `${order.amount}`
      const orderType = order.type === "buy" ? "💰 BUY" : "💱 SELL"

      // Get customer info
      let customerInfo = "Unknown"
      try {
        const customerDoc = await db.collection("users").doc(order.userId.toString()).get()
        if (customerDoc.exists) {
          const customer = customerDoc.data()
          customerInfo = customer?.username ? `@${customer.username}` : customer?.first_name || `User ${order.userId}`
        }
      } catch (error) {
        customerInfo = `User ${order.userId}`
      }

      // Get staff info
      let staffInfo = "Unassigned"
      if (chat.staffId) {
        try {
          const staffDisplayName = await getStaffDisplayName(chat.staffId)
          staffInfo = staffDisplayName
        } catch (error) {
          staffInfo = `Staff ${chat.staffId}`
        }
      }

      chatsList += `🆔 ${orderType} <code>#${chat.orderId.slice(-8)}</code>\n`
      chatsList += `🪙 ${order.symbol} - ${amountDisplay}\n`
      chatsList += `👤 Customer: ${customerInfo}\n`
      chatsList += `👨‍💼 Staff: ${staffInfo}\n\n`
    }

    await ctx.reply(chatsList, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🔙 Back to Panel", "back_to_panel"),
    })
  } catch (error) {
    console.error("Error showing active chats:", error)
    await ctx.reply("❌ Sorry, there was an error loading the active chats.")
  }
}

async function showCustomerMainMenu(ctx) {
  await ctx.reply("Welcome to the Vintage & Crap Coin Store!\n\nWhat would you like to do?", {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Buy Crypto" }, { text: "💱 Sell Crypto" }],
        [{ text: "📋 Available Tokens" }, { text: "📊 My Transactions" }],
        [{ text: "❓ Help & Support" }],
      ],
      resize_keyboard: true,
    },
  })
}
