// server.js (ESM)
import { exec } from "child_process";
import cors from "cors";
import express from "express";
import { promises as fs } from "fs";
import path from "path";
import multer from "multer";

const app = express();
app.use(cors());

// Resolve absolute uploads folder path
const uploadFolder = path.resolve("uploads");

// --- exec wrapper with bigger buffer and stderr in errors ---
const execCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        console.error("Command failed:", command, stderr);
        return reject(new Error(`${error.message}\n${stderr}`));
      }
      resolve(stdout);
    });
  });

// --- lipSyncMessage function ---
const lipSyncMessage = async (inputFilePath) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.dirname(inputFilePath);
  const base = path.basename(inputFilePath, path.extname(inputFilePath));
  const wavPath = path.join(dir, `${base}_${suffix}.wav`);
  const jsonPath = path.join(dir, `${base}_${suffix}.json`);

  try {
    // 1) Convert to WAV (16k mono)
    await execCommand(`ffmpeg -y -i "${inputFilePath}" -ar 16000 -ac 1 "${wavPath}"`);

    // 2) Run rhubarb
    await execCommand(`./bin/rhubarb -f json -o "${jsonPath}" "${wavPath}" -r phonetic`);

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
  console.log("Received file:", file);  // <--- Debug log

  if (!file) return res.status(400).json({ error: "Please upload an audio file in field 'audio'." });

  try {
    const { lipsyncJson } = await lipSyncMessage(file.path);
    const audioBase64 = await audioFileToBase64(file.path);

    res.json({ success: true, lipsync: lipsyncJson, audioBase64 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- start server ---
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`LipSync server running on port ${port}`);
  console.log(`Make sure '${uploadFolder}' folder exists and is writable!`);
});
