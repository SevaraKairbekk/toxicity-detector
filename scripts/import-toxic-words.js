const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// Подключение к MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user123:user123pass@cluster.ye9rgkq.mongodb.net/toxicity_db";

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
});

// Схема для токсичных слов
const toxicWordSchema = new mongoose.Schema({
  word: { type: String, required: true, unique: true },
  meaning: String,
  toxic: Number,
  insult: Number,
  obscenity: Number,
  rudeness: Number,
  reputation: Number,
  danger: Number
});

const ToxicWord = mongoose.model("ToxicWord", toxicWordSchema);

async function importData() {
  try {
    // Читаем данные из JSON файла
    const jsonPath = path.join(__dirname, "..", "data", "toxic-words.json");
    const toxicWordsData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    
    console.log(` Найдено ${toxicWordsData.length} слов для импорта`);
    
    // Очищаем коллекцию перед импортом
    await ToxicWord.deleteMany({});
    console.log(" Старые данные удалены");
    
    // Импортируем новые данные
    const result = await ToxicWord.insertMany(toxicWordsData);
    console.log(` Импортировано ${result.length} слов`);
    
    // Проверка
    const count = await ToxicWord.countDocuments();
    console.log(`Всего слов в базе: ${count}`);
    
    process.exit(0);
  } catch (error) {
    console.error(" Ошибка импорта:", error);
    process.exit(1);
  }
}

importData();