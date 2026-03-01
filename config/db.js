// PATH: backend/config/db.js
import mongoose from "mongoose";

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is missing in .env");

  // (اختياري) يقلل تحذيرات ويخلي الاستعلامات أوضح
  mongoose.set("strictQuery", true);

  // منع تكرار listeners لو حصل restart (nodemon)
  // ✅ بدل removeAllListeners() على connection كله، هنشيل اللي احنا ضفناه فقط
  mongoose.connection.removeAllListeners("disconnected");
  mongoose.connection.removeAllListeners("error");
  mongoose.connection.removeAllListeners("reconnected");

  // ✅ إعدادات مناسبة لـ MongoDB Atlas
  const options = {
    serverSelectionTimeoutMS: 15000, // وقت اختيار السيرفر
    connectTimeoutMS: 15000, // وقت إنشاء الاتصال
    socketTimeoutMS: 45000, // وقت العمليات على السوكيت
    maxPoolSize: 10, // مناسب للتطوير
    retryWrites: true,
  };

  try {
    const conn = await mongoose.connect(uri, options);

    console.log(
      `\n✅ متصل بقاعدة البيانات بنجاح
📦 اسم قاعدة البيانات: ${conn.connection.name}
🌍 المضيف: ${conn.connection.host}\n`
    );

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ تم قطع الاتصال بقاعدة البيانات!");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ تم إعادة الاتصال بقاعدة البيانات!");
    });

    mongoose.connection.on("error", (err) => {
      console.log("❌ DB Error:", err?.message || err);
    });

    return conn;
  } catch (err) {
    console.log("❌ فشل الاتصال بقاعدة البيانات:", err?.message || err);
    throw err;
  }
};

export default connectDB;
