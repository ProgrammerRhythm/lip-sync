// server.js (ESM)
import { exec } from "child_process";
import cors from "cors";
import express from "express";
import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

// __dirname fix for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Upload folder
const uploadFolder = path.resolve(__dirname, "uploads");

if (!fsSync.existsSync(uploadFolder)) {
  fsSync.mkdirSync(uploadFolder, { recursive: true });
  console.log(`Created uploads folder at ${uploadFolder}`);
}

// --- exec wrapper with bigger buffer + stderr in errors ---
const execCommand = (command) =>
  new Promise((resolve, reject) => {
    console.log(`\n▶ Running command: ${command}`);
    exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Command failed: ${command}`);
        console.error("stderr:", stderr);
        return reject(new Error(`${error.message}\n${stderr}`));
      }
      resolve(stdout);
    });
  });

// --- path safe for shell (Windows friendly) ---
const safePath = (p) => `"${p.replace(/\\/g, "/")}"`;

// --- lipSyncMessage function ---
const lipSyncMessage = async (inputFilePath) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.dirname(inputFilePath);
  const base = path.basename(inputFilePath, path.extname(inputFilePath));
  const wavPath = path.join(dir, `${base}_${suffix}.wav`);
  const jsonPath = path.join(dir, `${base}_${suffix}.json`);

  try {
    // 1) Convert to WAV (16k mono)
    await execCommand(`ffmpeg -y -i ${safePath(inputFilePath)} -ar 16000 -ac 1 ${safePath(wavPath)}`);

    // 2) Run rhubarb (make sure rhubarb.exe is in ./bin)
    await execCommand(`${safePath(path.join(__dirname, "bin", process.platform === "win32" ? "rhubarb.exe" : "rhubarb"))} -f json -o ${safePath(jsonPath)} ${safePath(wavPath)} -r phonetic`);

    // 3) Read and parse JSON
    const jsonStr = await fs.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(jsonStr);

    return { lipsyncJson: parsed, wavPath, jsonPath };
  } catch (err) {
    throw new Error(`lipSyncMessage failed: ${err.message}`);
  }
};

// --- helper to base64 encode an audio file ---
const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

// --- multer setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// --- POST: upload an audio file and return lipsync JSON + audio ---
app.post("/lipsync/upload", upload.single("audio"), async (req, res) => {
  const file = req.file;
  console.log("📥 Received file:", file?.path);

  if (!file) {
    return res.status(400).json({ error: "Please upload an audio file in field 'audio'." });
  }

  try {
    const { lipsyncJson } = await lipSyncMessage(file.path);
    const audioBase64 = await audioFileToBase64(file.path);

    res.json({ success: true, lipsync: lipsyncJson, audioBase64 });
  } catch (err) {
    console.error("💥 ERROR:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// --- start server ---
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`🚀 LipSync server running on port ${port}`);
  console.log(`📂 Make sure '${uploadFolder}' exists and is writable!`);
  console.log(`🔍 Ensure ffmpeg & rhubarb are installed and in correct paths!`);
});