import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

//  КОНФИГУРАЦИЯ 
const HF_TOKEN = "";
const MODEL_NAME = "cointegrated/rubert-tiny-toxicity";
const API_URL = `https://router.huggingface.co/hf-inference/models/${MODEL_NAME}`;
const TIMEOUT_MS = 30000;
const JWT_SECRET = "your-secret-key-change-this"; // Смените на сложный ключ!

// Деректер базасына қосылу 
const MONGODB_URI = "mongodb+srv://user123:<db_password>@cluster.ye9rgkq.mongodb.net/?appName=Cluster
";

mongoose.connect(MONGODB_URI)
    .then(() => console.log("MongoDB қосылды"))
    .catch(err => console.error("Қате MongoDB:", err));

// Деректер базасы моделі
// Қолданушылар
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    checksCount: { type: Number, default: 0 } // Тексерістер саны
});

// Тексерістер тарихы
const historySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true },
    result: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const History = mongoose.model("History", historySchema);

// Токенді тексеру
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
        return res.status(401).json({ error: "Қолдану үшін жүйеге кіріңіз" });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Токен жарамсыз" });
        }
        req.user = user;
        next();
    });
};

//  API ЭНДПОИНТЫ 

// Тіркелу
app.post("/api/register", async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: "Барлық өрістерді толтырыңыз" });
    }
    
    try {
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: "Пайдаланушы аты немесе email қолданыста" });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();
        
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
        
    } catch (error) {
        console.error("Регистрация қатесі:", error);
        res.status(500).json({ error: "Сервер қатесі" });
    }
});

// Шығу
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: "Пайдаланушы табылмады" });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: "Құпия сөз қате" });
        }
        
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
        
    } catch (error) {
        console.error("Кіру қатесі:", error);
        res.status(500).json({ error: "Сервер қатесі" });
    }
});

// Уыттылықты тексеру(тексеріс тарихымен)
app.post("/check", authenticateToken, async (req, res) => {
    const { text } = req.body;
    const userId = req.user.userId;
    
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "Мәтінді енгізіңіз", toxic: false, score: 0, reason: "Мәтінді енгізіңіз" });
    }
    
    try {
        console.log(`📝 Мәтінді талдау: "${text.trim()}" (Пайдаланушы: ${req.user.username})`);
        
        const fetchPromise = fetch(API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
                inputs: text,
                options: { wait_for_model: true }
            }),
        });
        
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS));
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (response.status === 503) {
            return res.json({ toxic: false, score: 0, reason: "Модель жүктелуде, кейінірек қайталаңыз", error: "model_loading" });
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Парсинг ответа
        let scores = { "non-toxic": 0, "insult": 0, "obscenity": 0, "threat": 0, "dangerous": 0 };
        let items = [];
        
        if (Array.isArray(data) && data[0] && Array.isArray(data[0])) items = data[0];
        else if (Array.isArray(data) && data[0] && data[0].label) items = data;
        else if (data && data[0] && Array.isArray(data[0])) items = data[0];
        
        for (const item of items) {
            if (item.label && typeof item.score === 'number') scores[item.label] = item.score;
        }
        
        const nonToxic = scores["non-toxic"] || 0;
        const insult = scores["insult"] || 0;
        const obscenity = scores["obscenity"] || 0;
        const threat = scores["threat"] || 0;
        const dangerous = scores["dangerous"] || 0;
        
        const isToxic = nonToxic < 0.7 || dangerous > 0.5 || insult > 0.5;
        const toxicScore = Math.max(insult, obscenity, threat, dangerous);
        
        let reason = "";
        if (dangerous > 0.7) reason = " Өте қауіпті: мәтін беделге нұқсан келтіруі мүмкін";
        else if (dangerous > 0.5) reason = " Жоғары тәуекел: беделге ықтимал зиян";
        else if (insult > 0.7) reason = " Айқын қорлау";
        else if (insult > 0.5) reason = " Жасырын қорлау немесе менсінбеушілік";
        else if (threat > 0.5) reason = " Қауіп-қатер анықталды";
        else if (obscenity > 0.5) reason = " Былапыт сөздер";
        else if (nonToxic < 0.7) reason = " Мәтінде токсинді элементтер бар";
        else reason = " Мәтін қауіпсіз";
        
        const result = {
            toxic: isToxic,
            score: toxicScore,
            reason: reason,
            details: { non_toxic: nonToxic, insult, obscenity, threat, dangerous }
        };
        
        // Тарихты сақтау
        await History.create({ userId, text, result });
        await User.findByIdAndUpdate(userId, { $inc: { checksCount: 1 } });
        
        res.json(result);
        
    } catch (error) {
        console.error("Сервер қатесі:", error.message);
        res.status(500).json({ error: "Сервер қатесі", toxic: false, score: 0, reason: "Мәтінді тексеру мүмкін болмады" });
    }
});

// Тарихты қарау және алу
app.get("/api/history", authenticateToken, async (req, res) => {
    try {
        const history = await History.find({ userId: req.user.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: "Тарихты жүктеу мүмкін болмады" });
    }
});

// Қолданушы статистикасын алу
app.get("/api/stats", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        const totalChecks = user.checksCount;
        const toxicChecks = await History.countDocuments({ userId: req.user.userId, "result.toxic": true });
        
        res.json({ totalChecks, toxicChecks, safeChecks: totalChecks - toxicChecks });
    } catch (error) {
        res.status(500).json({ error: "Статистиканы жүктеу мүмкін болмады" });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", model: MODEL_NAME, timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 Модель: ${MODEL_NAME}`);
    console.log(`🔑 Токен: ${HF_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
});