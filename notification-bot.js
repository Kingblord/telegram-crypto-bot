const express = require("express")
const { Bot, InlineKeyboard } = require("grammy")
const admin = require("firebase-admin")

const app = express()
app.use(express.json())

// Use same Firebase instance
const db = admin.firestore()

// Create notification bot
const notificationBot = new Bot(process.env.NOTIFICATION_BOT_TOKEN)

// Setup notification bot
async function setupNotificationBot() {
  try {
    await notificationBot.init()

    // Handle quick actions from notifications
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
        }
      } catch (error) {
        console.error("Error in notification callback:", error)
      }
    })

    // Quick take from notification
    async function handleQuickTake(ctx, orderId, userId) {
      try {
        // Check if user is staff
        const adminDoc = await db.collection("admins").doc(userId.toString()).get()
        const careDoc = await db.collection("customerCare").doc(userId.toString()).get()
        
        if (!adminDoc.exists && !careDoc.exists) {
          await ctx.reply("❌ You are not authorized.")
          return
        }

        const transactionDoc = await db.collection("transactions").doc(orderId).get()
        if (!transactionDoc.exists) {
          await ctx.reply("❌ Order not found or already taken.")
          return
        }

        const transaction = transactionDoc.data()
        if (transaction.status !== "pending") {
          await ctx.reply("❌ Order no longer available.")
          return
        }

        // Take the order
        await db.collection("transactions").doc(orderId).update({
          status: "in_progress",
          assignedStaff: userId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        await ctx.reply(
          `✅ <b>ORDER TAKEN!</b>\n\n` +
          `🆔 Order: <code>#${orderId}</code>\n` +
          `🔄 ${transaction.type.toUpperCase()} ${transaction.amount} ${transaction.symbol}\n\n` +
          `🎯 Go to main bot to continue processing.`,
          { parse_mode: "HTML" }
        )

        console.log(`✅ Order ${orderId} taken via notification bot`)
      } catch (error) {
        console.error("Error taking order:", error)
        await ctx.reply("❌ Error taking order.")
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
        
        let text = `📋 <b>ORDER DETAILS</b>\n\n`
        text += `🆔 ID: <code>#${orderId}</code>\n`
        text += `🔄 ${transaction.type.toUpperCase()} ${transaction.amount} ${transaction.symbol}\n`
        text += `👤 Customer: ${transaction.userId}\n`
        text += `📊 Status: ${transaction.status}`

        const keyboard = new InlineKeyboard()
        if (transaction.status === "pending") {
          keyboard.text("🎯 Take Order", `take_${orderId}`)
        }

        await ctx.reply(text, {
          parse_mode: "HTML",
          reply_markup: keyboard
        })
      } catch (error) {
        console.error("Error showing order:", error)
      }
    }

    notificationBot.command("start", async (ctx) => {
      await ctx.reply(
        "🔔 <b>NOTIFICATION BOT</b>\n\n" +
        "This bot sends you order notifications.\n\n" +
        "You can quickly take orders here, then go to the main bot to process them.",
        { parse_mode: "HTML" }
      )
    })

    console.log("✅ Notification bot ready!")
  } catch (error) {
    console.error("❌ Notification bot error:", error)
  }
}

// Only setup if token exists
if (process.env.NOTIFICATION_BOT_TOKEN) {
  setupNotificationBot()
} else {
  console.log("⚠️ No notification bot token - skipping")
}

// Function to send notifications (called from main bot)
async function sendStaffNotification(message, orderId = null) {
  if (!process.env.NOTIFICATION_BOT_TOKEN) return

  try {
    const keyboard = new InlineKeyboard()
    
    if (orderId) {
      keyboard
        .text("🎯 Take Order", `take_${orderId}`)
        .text("👀 View Details", `view_${orderId}`)
    }

    // Get all staff
    const adminsSnapshot = await db.collection("admins").get()
    const careSnapshot = await db.collection("customerCare").get()

    const allStaff = []
    adminsSnapshot.docs.forEach(doc => allStaff.push(doc.id))
    careSnapshot.docs.forEach(doc => allStaff.push(doc.id))

    // Send to all staff
    for (const staffId of allStaff) {
      try {
        await notificationBot.api.sendMessage(staffId, message, {
          reply_markup: keyboard,
          parse_mode: "HTML"
        })
      } catch (error) {
        console.error(`Error notifying ${staffId}:`, error)
      }
    }
  } catch (error) {
    console.error("Error sending notifications:", error)
  }
}

// Webhook for notification bot
app.post("/notification-webhook", async (req, res) => {
  try {
    if (process.env.NOTIFICATION_BOT_TOKEN) {
      await notificationBot.handleUpdate(req.body)
    }
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error("Notification webhook error:", error)
    res.status(500).json({ error: "Error" })
  }
})

module.exports = { sendStaffNotification }

const PORT = process.env.NOTIFICATION_PORT || 3001
app.listen(PORT, () => {
  console.log(`🔔 Notification service on port ${PORT}`)
})
