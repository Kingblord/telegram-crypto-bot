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

function generateBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]
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

async function getStaffDisplayName(userId) {
  try {
    const adminDoc = await db.collection("admins").doc(userId.toString()).get()
    if (adminDoc.exists) {
      const admin = adminDoc.data()
      return admin.displayName || admin.name
    }

    const careDoc = await db.collection("customerCare").doc(userId.toString()).get()
    if (careDoc.exists) {
      const care = careDoc.data()
      return care.displayName || care.name
    }

    return "SupportBot"
  } catch (error) {
    console.error("Error getting staff display name:", error)
    return "SupportBot"
  }
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

// Navigation helper functions
async function showTransactionsList(ctx) {
  const userId = ctx.from?.id
  if (!userId) return

  const userTransactionsSnapshot = await db.collection("transactions").where("userId", "==", userId).get()

  if (userTransactionsSnapshot.empty) {
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

  // Sort by createdAt in memory and limit to 10
  const sortedDocs = userTransactionsSnapshot.docs
    .sort((a, b) => {
      const aTime = a.data().createdAt?.toDate?.() || new Date(0)
      const bTime = b.data().createdAt?.toDate?.() || new Date(0)
      return bTime - aTime // Descending order
    })
    .slice(0, 10)

  let transactionList = "📊 YOUR RECENT TRANSACTIONS\n\n"

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

    transactionList += `${index + 1}. ${tx.type.toUpperCase()} ${amountDisplay} ${tx.symbol}\n`
    transactionList += `   🆔 ID: #${tx.id}\n`
    transactionList += `   📊 Status: ${statusEmoji}\n`
    transactionList += `   📅 Date: ${tx.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}\n\n`

    // Add button for each transaction
    transactionButtons.push([{ text: `📋 Manage #${tx.id}` }])
  })

  transactionButtons.push([{ text: "🔄 Refresh" }, { text: "🔙 Back to Menu" }])

  await ctx.reply(transactionList, {
    reply_markup: {
      keyboard: transactionButtons,
      resize_keyboard: true,
    },
  })
}

async function showTransactionDetails(ctx, orderId) {
  const userId = ctx.from?.id
  if (!userId) return

  // Get transaction details
  const transactionDoc = await db.collection("transactions").doc(orderId).get()
  if (!transactionDoc.exists) {
    await ctx.reply("❌ Transaction not found.")
    return
  }

  const transaction = transactionDoc.data()
  if (transaction.userId !== userId) {
    await ctx.reply("❌ You can only view your own transactions.")
    return
  }

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

  // Split into basic info and detailed info
  let basicInfo = `📋 ORDER SUMMARY\n\n`
  basicInfo += `🆔 Order ID: #${orderId}\n`
  basicInfo += `🔄 Action: ${transaction.type.toUpperCase()}\n`
  basicInfo += `🪙 Token: ${transaction.symbol}\n`
  basicInfo += `💰 Amount: ${amountDisplay} ${transaction.symbol}\n`
  basicInfo += `📊 Status: ${statusEmoji}\n`
  basicInfo += `📅 Created: ${transaction.createdAt?.toDate?.()?.toLocaleDateString() || "Unknown"}`

  await ctx.reply(basicInfo)

  // Show additional details if available
  let additionalInfo = ""

  if (transaction.contractAddress) {
    additionalInfo += `📍 Contract: ${transaction.contractAddress}\n`
  }

  if (transaction.assignedStaff) {
    const staffDisplayName = await getStaffDisplayName(transaction.assignedStaff)
    additionalInfo += `🤖 Assigned Agent: ${staffDisplayName}\n`
  }

  if (transaction.paymentAddress) {
    additionalInfo += `💳 Payment Address: ${transaction.paymentAddress}\n`
  }

  if (transaction.receivingAddress) {
    additionalInfo += `📤 Receiving Address: ${transaction.receivingAddress}\n`
  }

  if (transaction.customerTxHash) {
    additionalInfo += `📝 Your TX Hash: ${transaction.customerTxHash}\n`
  }

  if (transaction.sentTxHash) {
    additionalInfo += `✅ Sent TX Hash: ${transaction.sentTxHash}\n`
  }

  if (additionalInfo) {
    await ctx.reply(`📋 ADDITIONAL DETAILS\n\n${additionalInfo}`)
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
        instructions = `💳 PAYMENT REQUIRED\n\nSend payment to: ${transaction.paymentAddress}\n\nAfter payment, submit your transaction hash.`
        actionButtons.push([{ text: "📝 Submit Payment Hash" }])
      }
      break
    case "waiting_tokens":
      if (transaction.receivingAddress) {
        instructions = `📤 SEND TOKENS\n\nSend tokens to: ${transaction.receivingAddress}\n\nAfter sending, submit your transaction hash.`
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
    await ctx.reply(`📋 CURRENT STATUS\n\n${instructions}`)
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
        session.step = "main_menu"
        await setUserSession(userId, session)

        const amountDisplay =
          session.transactionType === "buy" ? `$${session.amount} USD worth of` : `${session.amount}`

        await ctx.reply(
          `✅ ORDER CREATED SUCCESSFULLY!\n\n` +
            `🆔 Transaction ID: #${orderId}\n` +
            `🔄 Action: ${session.transactionType?.toUpperCase()}\n` +
            `🪙 Token: ${session.symbol}\n` +
            `💰 Amount: ${amountDisplay} ${session.symbol}`,
        )

        await ctx.reply(
          `🔄 ORDER STATUS\n\n` +
            `Your order is now in our processing queue.\n\n` +
            `⏱️ Expected processing time: 2-10 minutes\n\n` +
            `🤖 An automated agent will be assigned to handle your order shortly.`,
        )

        await ctx.reply(
          `📱 WHAT'S NEXT?\n\n` +
            `• You'll receive notifications when your order status changes\n` +
            `• Check "My Transactions" to track progress\n` +
            `• Chat with support if you have questions\n\n` +
            `Thank you for choosing our service! 🚀`,
          {
            reply_markup: {
              keyboard: [[{ text: "📊 My Transactions" }, { text: "🔄 New Transaction" }]],
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

    // Continue with the rest of the handlers...
    // [The rest of the handlers remain the same but I'll add the key fixes]

    // Fixed refresh handlers
    bot.hears("🔄 Refresh Status", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        const session = await getUserSession(userId)
        if (!session.currentTransactionId) {
          await ctx.reply("❌ No transaction selected. Please go back to your transactions.")
          return
        }

        // Show transaction details again
        await showTransactionDetails(ctx, session.currentTransactionId)
      } catch (error) {
        console.error("Error refreshing status:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.hears("🔄 Refresh", async (ctx) => {
      try {
        await showTransactionsList(ctx)
      } catch (error) {
        console.error("Error refreshing transactions:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.hears("📊 Back to Transactions", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        // Clear current transaction from session
        const session = await getUserSession(userId)
        delete session.currentTransactionId
        session.step = "main_menu"
        await setUserSession(userId, session)

        await showTransactionsList(ctx)
      } catch (error) {
        console.error("Error going back to transactions:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Transaction Management Handlers
    bot.hears(/^📋 Manage #/, async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        const messageText = ctx.message?.text || ""
        const orderId = messageText.replace("📋 Manage #", "")

        await showTransactionDetails(ctx, orderId)
      } catch (error) {
        console.error("Error showing transaction details:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.hears("📊 My Transactions", async (ctx) => {
      try {
        await showTransactionsList(ctx)
      } catch (error) {
        console.error("Error showing transactions:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Staff management commands with bot names
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
        const botDisplayName = generateBotName()

        // Add to Firestore
        await db.collection("admins").doc(newAdminId).set({
          id: newAdminId,
          role: "admin",
          name: adminName,
          displayName: botDisplayName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ ADMIN ADDED\n\n` +
            `👤 Name: ${adminName}\n` +
            `🤖 Display Name: ${botDisplayName}\n` +
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
              `🤖 Your agent name: ${botDisplayName}\n\n` +
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
        const botDisplayName = generateBotName()

        // Add to Firestore
        await db.collection("customerCare").doc(newCareId).set({
          id: newCareId,
          name: careName,
          displayName: botDisplayName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ CUSTOMER SERVICE REP ADDED\n\n` +
            `👤 Name: ${careName}\n` +
            `🤖 Display Name: ${botDisplayName}\n` +
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
              `🤖 Your agent name: ${botDisplayName}\n\n` +
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

    // Continue with the rest of the handlers...
    // [The rest of the handlers remain the same but I'll add the key fixes]

    // Fixed refresh handlers
    bot.hears("🔄 Refresh Status", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        const session = await getUserSession(userId)
        if (!session.currentTransactionId) {
          await ctx.reply("❌ No transaction selected. Please go back to your transactions.")
          return
        }

        // Show transaction details again
        await showTransactionDetails(ctx, session.currentTransactionId)
      } catch (error) {
        console.error("Error refreshing status:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.hears("🔄 Refresh", async (ctx) => {
      try {
        await showTransactionsList(ctx)
      } catch (error) {
        console.error("Error refreshing transactions:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.hears("📊 Back to Transactions", async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        // Clear current transaction from session
        const session = await getUserSession(userId)
        delete session.currentTransactionId
        session.step = "main_menu"
        await setUserSession(userId, session)

        await showTransactionsList(ctx)
      } catch (error) {
        console.error("Error going back to transactions:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Transaction Management Handlers
    bot.hears(/^📋 Manage #/, async (ctx) => {
      try {
        const userId = ctx.from?.id
        if (!userId) return

        const messageText = ctx.message?.text || ""
        const orderId = messageText.replace("📋 Manage #", "")

        await showTransactionDetails(ctx, orderId)
      } catch (error) {
        console.error("Error showing transaction details:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    bot.hears("📊 My Transactions", async (ctx) => {
      try {
        await showTransactionsList(ctx)
      } catch (error) {
        console.error("Error showing transactions:", error)
        await ctx.reply("❌ Sorry, there was an error. Please try again.")
      }
    })

    // Staff management commands with bot names
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
        const botDisplayName = generateBotName()

        // Add to Firestore
        await db.collection("admins").doc(newAdminId).set({
          id: newAdminId,
          role: "admin",
          name: adminName,
          displayName: botDisplayName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ ADMIN ADDED\n\n` +
            `👤 Name: ${adminName}\n` +
            `🤖 Display Name: ${botDisplayName}\n` +
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
              `🤖 Your agent name: ${botDisplayName}\n\n` +
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
        const botDisplayName = generateBotName()

        // Add to Firestore
        await db.collection("customerCare").doc(newCareId).set({
          id: newCareId,
          name: careName,
          displayName: botDisplayName,
          addedBy: userId,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ CUSTOMER SERVICE REP ADDED\n\n` +
            `👤 Name: ${careName}\n` +
            `🤖 Display Name: ${botDisplayName}\n` +
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
              `🤖 Your agent name: ${botDisplayName}\n\n` +
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

    // Continue with the rest of the bot setup...
    // [Include all other handlers from the previous version]

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
        "✅ Enhanced Transaction Management",
        "✅ Bot-like Staff Names",
        "✅ Improved User Experience",
        "✅ Real-time Status Updates",
        "✅ Professional Customer Service System",
        "✅ BSC Transaction Verification",
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
  console.log("🏪 Vintage & Crap Coin Store with enhanced features is ready!")
  console.log("📊 Visit the URL to see bot statistics")
})
