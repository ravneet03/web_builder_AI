require("dotenv").config();
import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { BASE_PROMPT, getSystemPrompt } from "./prompts";
import { TextBlock } from "@anthropic-ai/sdk/resources";
import { basePrompt as nodeBasePrompt } from "./default/node";
import { basePrompt as reactBasePrompt } from "./default/react";
import cors from "cors";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";

const anthropic = new Anthropic();
const app = express();

app.use(cors());
app.use(express.json());

// ---------------------
// Temporary storage path
// ---------------------
const PROJECTS_DIR = path.join(__dirname, "../projects");
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR);

// =========================
// /template endpoint
// =========================
app.post("/template", async (req: Request, res: Response) => {
  try {
    const prompt = req.body.prompt;

    const response = await anthropic.messages.create({
      messages: [{ role: "user", content: prompt }],
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 200,
      system:
        "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra",
    });

    const answer = (response.content[0] as TextBlock).text; // react or node
    const projectId = uuidv4(); // generate unique project ID
    const projectPath = path.join(PROJECTS_DIR, projectId);
    fs.mkdirSync(projectPath);

    // Save base prompt file for demo (can save full project later)
    fs.writeFileSync(path.join(projectPath, "README.txt"), `Project Type: ${answer}\n\nPrompt: ${prompt}`);

    // Respond including projectId
    if (answer === "react") {
      res.json({
        prompts: [
          BASE_PROMPT,
          `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
        ],
        uiPrompts: [reactBasePrompt],
        projectId,
      });
      return;
    }

    if (answer === "node") {
      res.json({
        prompts: [
          `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
        ],
        uiPrompts: [nodeBasePrompt],
        projectId,
      });
      return;
    }

    res.status(403).json({ message: "You cant access this" });
  } catch (error) {
    console.error("Error in /template:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================
// /chat endpoint
// =========================
app.post("/chat", async (req: Request, res: Response) => {
  try {
    const messages = req.body.messages;

    const response = await anthropic.messages.create({
      messages,
      model: "claude-3-5-sonnet-latest",
      max_tokens: 8000,
      system: getSystemPrompt(),
    });

    console.log("response");
    res.json({
      response: (response.content[0] as TextBlock)?.text,
    });
  } catch (error) {
    console.error("Error in /chat:", error);
    res.status(500).json({ message: "Chat error" });
  }
});

// =========================
// /download/:projectId endpoint
// =========================
app.get("/download/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const projectPath = path.join(PROJECTS_DIR, projectId);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ message: "Project not found" });
    }

    const zipPath = path.join(PROJECTS_DIR, `${projectId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, `project-${projectId}.zip`, (err) => {
        if (err) console.error("Error sending ZIP:", err);
        fs.unlinkSync(zipPath); // clean up
      });
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(output);
    archive.directory(projectPath, false);
    archive.finalize();
  } catch (error) {
    console.error("Error in /download:", error);
    res.status(500).json({ message: "Download error" });
  }
});

// =========================
// Start Server
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
