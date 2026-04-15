const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");

// Подключение к MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user123:user123pass@cluster.ye9rgkq.mongodb.net/toxicity_db";
mongoose.connect(MONGODB_URI);

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

async function importFromExcel() {
  try {
    const filePath = path.join(__dirname, "..", "data", "Уытты сөздер талдауы_ 31-60 блок (1).xlsx");
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    console.log(`Найдено ${rows.length} строк.`);

    const toxicWords = [];
    for (const row of rows) {
      const word = row["Уытты сөз"] || row.word;
      if (!word) continue;

      const meaning = row["Мағынасы"] || "";
      const toxic = parseFloat(row["Токсиндік"]) || 0;
      const insult = parseFloat(row["Қорлау (%)"]) || 0;
      const obscenity = parseFloat(row["Былапыт (%)"]) || 0;
      const rudeness = parseFloat(row["Дөрекілік (%)"]) || 0;
      const reputation = parseFloat(row["Репутация (%)"]) || 0;
      const danger = parseFloat(row["Қауіп (%)"]) || 0;

      toxicWords.push({ word, meaning, toxic, insult, obscenity, rudeness, reputation, danger });
    }

    console.log(`Подготовлено ${toxicWords.length} слов.`);
    await ToxicWord.deleteMany({});
    await ToxicWord.insertMany(toxicWords);
    console.log(`Импортировано ${toxicWords.length} слов.`);
    process.exit(0);
  } catch (err) {
    console.error("Ошибка импорта:", err);
    process.exit(1);
  }
}

importFromExcel();