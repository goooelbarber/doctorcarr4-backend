// PATH: backend/server.js
import express from "express";
import dotenv from "dotenv";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import os from "os";
import { Server } from "socket.io";

import connectDB from "./config/db.js";

// Routes
import userRoutes from "./routes/userRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import technicianRoutes from "./routes/technicianRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import accidentRoutes from "./routes/accidentRoutes.js";
import carTypesRoutes from "./routes/carTypes.routes.js";
import maintenanceRoutes from "./routes/maintenance.routes.js";
import supportChatRoutes from "./routes/supportChatRoutes.js";
import centerRoutes from "./routes/centerRoutes.js";
import orderEstimateRoutes from "./routes/orderEstimate.routes.js";

// ✅ AI routes (Photo Diagnosis)
import aiRoutes from "./routes/aiRoutes.js";

// Socket modules
import { attachSupportChatSocket } from "./socket/supportChatSocket.js";
import Order from "./models/orderModel.js";
import Center from "./models/centerModel.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

// ===================== ENV =====================
// Render بيحط NODE_ENV=production غالبًا
const IS_PROD = process.env.NODE_ENV === "production";

// ✅ الأهم: Render بيدي PORT لازم تستخدمه
const PORT = Number(process.env.PORT || 5555);

// ✅ لازم تسمع على 0.0.0.0 في الاستضافة
const HOST = "0.0.0.0";

// طلبات أوبر لازم يكون ليها timeout
const ORDER_TIMEOUT_SEC = Number(process.env.ORDER_TIMEOUT_SEC || 60);

// PRODUCTION: origins من env
// مثال: CORS_ORIGINS=https://doctorcar.app,https://admin.doctorcar.app
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ===================== Mongoose =====================
mongoose.set("autoIndex", !IS_PROD);

// ===================== Security + Parsing =====================
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ===================== CORS =====================
// ✅ تعديل مهم: لو Production ومش محدد CORS_ORIGINS، نخليه يفتح بدل مايقفل كل حاجة بالغلط
const corsOptions = IS_PROD
  ? {
      origin: (origin, cb) => {
        // موبايل/بوستمان ساعات origin = undefined
        if (!origin) return cb(null, true);

        // لو مفيش origins متحددة في env -> اسمح (عشان ما تقعش deployment)
        if (CORS_ORIGINS.length === 0) return cb(null, true);

        if (CORS_ORIGINS.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }
  : {
      origin: "*",
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    };

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ===================== Debug Logger (DEV فقط) =====================
if (!IS_PROD) {
  app.use((req, res, next) => {
    console.log("➡️", req.method, req.url);
    next();
  });
}

// ===================== Health =====================
app.get("/", (req, res) => {
  res.status(200).send("🚗 Doctor Car Backend يعمل بنجاح ✅");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "API is healthy ✅",
    port: PORT,
    db: mongoose.connection?.readyState,
    env: process.env.NODE_ENV || "development",
  });
});

// ===================== Socket =====================
export const io = new Server(server, {
  cors: IS_PROD
    ? {
        // ✅ نفس منطق CORS: لو مفيش origins محددة اسمح
        origin: (origin, cb) => {
          if (!origin) return cb(null, true);
          if (CORS_ORIGINS.length === 0) return cb(null, true);
          if (CORS_ORIGINS.includes(origin)) return cb(null, true);
          return cb(new Error(`Socket CORS blocked: ${origin}`));
        },
        credentials: true,
        methods: ["GET", "POST"],
      }
    : { origin: "*", methods: ["GET", "POST"] },

  // ✅ مهم لتقليل timeouts على الموبايل
  transports: ["websocket", "polling"],
  allowEIO3: true, // اختياري
  pingTimeout: 20000,
  pingInterval: 25000,
});

// techId -> socketId
export const onlineTechnicians = new Map();

// ✅ orderId -> timeoutTimer
const orderTimeoutTimers = new Map();

/**
 * جدولة timeout للطلب (Uber-like)
 * لو محدش قبل خلال ORDER_TIMEOUT_SEC → ابعت timeout للمستخدم/الروم
 */
function scheduleOrderTimeout(orderId, userId) {
  try {
    clearOrderTimeout(orderId);

    const t = setTimeout(async () => {
      try {
        const order = await Order.findById(orderId);
        if (!order) return;

        const st = String(order.status || "");
        if (
          st === "assigned" ||
          st === "accepted" ||
          st === "in_progress" ||
          st === "completed"
        ) {
          return;
        }

        order.status = "timeout";
        await order.save();

        const payload = {
          orderId: String(orderId),
          status: "timeout",
          message: "لم يتم العثور على فني الآن",
        };

        io.to(String(orderId)).emit("orderStatusUpdated", payload);
        if (userId) {
          io.to(`user:${String(userId)}`).emit("order:timeout", payload);
          io.to(`user:${String(userId)}`).emit("orderStatusUpdated", payload);
        }

        console.log(`⏱️ Order timeout: ${orderId}`);
      } catch (e) {
        console.error("❌ timeout handler:", e?.message || e);
      } finally {
        clearOrderTimeout(orderId);
      }
    }, ORDER_TIMEOUT_SEC * 1000);

    orderTimeoutTimers.set(String(orderId), t);
  } catch (e) {
    console.error("❌ scheduleOrderTimeout:", e?.message || e);
  }
}

function clearOrderTimeout(orderId) {
  const key = String(orderId);
  const old = orderTimeoutTimers.get(key);
  if (old) clearTimeout(old);
  orderTimeoutTimers.delete(key);
}

// ✅ تمرير io لأي controller
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ===================== Routes =====================
app.use("/api/users", userRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/technicians", technicianRoutes);
app.use("/api/wallet", walletRoutes);

// ✅ AI routes
app.use("/api/ai", aiRoutes);

// ✅ IMPORTANT ORDER ROUTES
// ✅ Hook لازم يكون قبل orderRoutes عشان يمسك res.json
app.use("/api/orders", (req, res, next) => {
  const _json = res.json.bind(res);

  res.json = (body) => {
    try {
      // نفعّل فقط على create order
      if (req.method === "POST" && req.originalUrl === "/api/orders") {
        const statusCode = res.statusCode;
        if (statusCode === 201 && body?.order?._id) {
          const orderId = String(body.order._id);
          const userId = String(body.order.user?._id || body.order.user || "");
          scheduleOrderTimeout(orderId, userId);
          console.log(
            `⏱️ Timeout scheduled from hook: ${orderId} (${ORDER_TIMEOUT_SEC}s)`
          );
        }
      }
    } catch (e) {
      console.warn("⚠️ timeout hook failed:", e?.message || e);
    }

    return _json(body);
  };

  next();
});

app.use("/api/orders", orderRoutes);

// ✅ estimate routes
app.use("/api/orders", orderEstimateRoutes);

app.use("/api/payments", paymentRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/accidents", accidentRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/car-types", carTypesRoutes);
app.use("/api/support", supportChatRoutes);
app.use("/api/centers", centerRoutes);

// ===================== TEST: Fake Order (DEV فقط) =====================
if (!IS_PROD) {
  app.post("/api/test/fake-order", (req, res) => {
    const fakeOrder = {
      _id: "ORDER_TEST_123",
      userName: "محمد إبراهيم",
      serviceType: "battery",
      distance: 3,
      chatId: "CHAT_TEST_123",
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    io.to("technicians").emit("order:new", fakeOrder);
    console.log("🧪 Fake order emitted to technicians:", fakeOrder);
    res.json({ ok: true, sentTo: "technicians" });
  });
}

// ===================== Socket Logic =====================
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Support chat
  try {
    attachSupportChatSocket(io, socket);
    console.log("💬 Support chat attached:", socket.id);
  } catch (e) {
    console.warn("⚠️ supportChat attach error:", e?.message || e);
  }

  // user online -> join user room
  socket.on("user:online", ({ userId }) => {
    if (!userId) return;
    socket.join(`user:${String(userId)}`);
    console.log(`👤 user online: ${userId} -> ${socket.id}`);
  });

  // technician online -> join rooms + map
  socket.on("technician:online", ({ technicianId }) => {
    if (!technicianId) return;

    const techId = String(technicianId);
    onlineTechnicians.set(techId, socket.id);

    socket.join("technicians");
    socket.join(`technician:${techId}`);

    socket.emit("technician:online:ok", {
      technicianId: techId,
      socketId: socket.id,
      onlineCount: onlineTechnicians.size,
    });

    console.log(`🛠️ technician online: ${techId} -> ${socket.id}`);
  });

  // ✅ join order room (يدعم String أو Object)
  socket.on("joinOrderRoom", (payload) => {
    const orderId =
      typeof payload === "string" ? payload : payload?.orderId || payload?._id;

    if (!orderId) return;

    socket.join(String(orderId));
    console.log(`📦 joined order room: ${String(orderId)} -> ${socket.id}`);
  });

  // ✅ leave order room
  socket.on("leaveOrderRoom", (payload) => {
    const orderId =
      typeof payload === "string" ? payload : payload?.orderId || payload?._id;

    if (!orderId) return;

    socket.leave(String(orderId));
    console.log(`📦 left order room: ${String(orderId)} -> ${socket.id}`);
  });

  // ✅ ORDER CANCEL
  socket.on("order:cancel", async ({ orderId, userId }) => {
    if (!orderId) return;

    try {
      const order = await Order.findById(orderId);
      if (!order) return;

      const st = String(order.status || "");
      if (
        st === "assigned" ||
        st === "accepted" ||
        st === "in_progress" ||
        st === "completed"
      ) {
        return;
      }

      order.status = "canceled";
      await order.save();

      // ✅ وقف timeout
      clearOrderTimeout(orderId);

      const payload = {
        orderId: String(orderId),
        status: "canceled",
        message: "تم إلغاء الطلب",
      };

      io.to(String(orderId)).emit("orderStatusUpdated", payload);

      const uid = userId || order.user?._id || order.user;
      if (uid) {
        io.to(`user:${String(uid)}`).emit("order:canceled", payload);
        io.to(`user:${String(uid)}`).emit("orderStatusUpdated", payload);
      }

      console.log(`🛑 Order canceled: ${orderId}`);
    } catch (e) {
      console.error("❌ order:cancel:", e?.message || e);
    }
  });

  /**
   * ✅ ORDER ACCEPT (Uber-like)
   */
  socket.on("order:accept", async ({ orderId, technicianId }) => {
    if (!orderId || !technicianId) return;

    try {
      const updated = await Order.findOneAndUpdate(
        { _id: orderId, status: { $in: ["pending", "searching", "contacting"] } },
        {
          $set: {
            status: "assigned",
            acceptedAt: new Date(),
            "technician.techId": String(technicianId),
          },
        },
        { new: true }
      );

      if (!updated) {
        socket.emit("order:accept:failed", {
          orderId,
          reason: "Order already taken / not pending",
        });
        return;
      }

      // ✅ وقف timeout أول ما اتقبل
      clearOrderTimeout(orderId);

      const payload = updated.toObject ? updated.toObject() : updated;

      socket.emit("order:accepted", payload);

      const userId = payload.user?._id || payload.user;
      if (userId) {
        io.to(`user:${String(userId)}`).emit("order:accepted", payload);
        io.to(`user:${String(userId)}`).emit("orderStatusUpdated", {
          orderId: String(orderId),
          status: "assigned",
          message: "تم العثور على فني",
          technicianId: String(technicianId),
        });
      }

      io.to(String(orderId)).emit("orderStatusUpdated", {
        orderId: String(orderId),
        status: "assigned",
        message: "تم العثور على فني",
        technicianId: String(technicianId),
      });

      console.log(`✅ Order assigned: ${orderId} by tech ${technicianId}`);
    } catch (e) {
      console.error("❌ order:accept:", e?.message || e);
      socket.emit("order:accept:failed", { orderId, reason: "Server error" });
    }
  });

  socket.on("order:reject", ({ orderId, technicianId }) => {
    if (!orderId || !technicianId) return;
    console.log(`❌ Order rejected: ${orderId} by tech ${technicianId}`);
  });

  socket.on("disconnect", () => {
    for (const [techId, sId] of onlineTechnicians.entries()) {
      if (sId === socket.id) {
        onlineTechnicians.delete(techId);
        console.log(`🛑 technician offline: ${techId}`);
        break;
      }
    }
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

// ===================== Endpoint مساعد (اختياري) =====================
app.post("/api/orders/:id/start-timeout", async (req, res) => {
  try {
    const orderId = String(req.params.id);
    const order = await Order.findById(orderId);
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });

    const userId = order.user?._id || order.user;
    scheduleOrderTimeout(orderId, userId);

    return res.json({ success: true, orderId, timeoutSec: ORDER_TIMEOUT_SEC });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: e?.message || "Server error" });
  }
});

// ===================== Error Handler =====================
app.use((err, req, res, next) => {
  console.error("🔥 Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: err?.message || "Server error",
  });
});

// ===================== Utils =====================
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

// ===================== Start =====================
async function startServer() {
  try {
    await connectDB();
  } catch (e) {
    console.error("⚠️ DB connect failed:", e?.message || e);
    // ✅ على Render لو DB وقعت، الأفضل توقف عشان الخدمة تبقى واضحة إنها فاشلة
    if (IS_PROD) process.exit(1);
  }

  if (mongoose.connection?.readyState === 1) {
    try {
      await Center.syncIndexes();
      console.log("✅ Center indexes synced (2dsphere ready)");
    } catch (e) {
      console.warn("⚠️ Center index sync failed:", e?.message || e);
    }
  }

  // ✅ Render-ready: listen on 0.0.0.0 + PORT from env
  server.listen(PORT, HOST, () => {
    console.log("====================================");
    console.log("🚀 Doctor Car Backend Running ✅");
    console.log(`🌍 Port: ${PORT}`);
    console.log(`🧷 Bound: http://${HOST}:${PORT}`);
    if (!IS_PROD) {
      console.log(`📱 Network (DEV): http://${getLocalIP()}:${PORT}`);
    }
    console.log(`⏱️ Order Timeout: ${ORDER_TIMEOUT_SEC}s`);
    console.log("====================================");
  });

  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use.`);
      process.exit(1);
    }
    console.error("❌ Server error:", err?.message || err);
    process.exit(1);
  });
}

startServer().catch((e) => {
  console.error("❌ Startup failed:", e?.message || e);
  if (IS_PROD) process.exit(1);
});

// ===================== Shutdown =====================
async function gracefulShutdown(signal) {
  console.log(`🧹 Graceful shutdown... (${signal})`);
  try {
    await mongoose.connection.close();
  } catch {}

  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));