import "dotenv/config";
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
import { parseXml } from "./steps";
import { v4 as uuidv4 } from "uuid";

// =========================
// Config
// =========================
const MODEL = process.env.AI_MODEL || "claude-3-haiku-20240307";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

    if (!prompt) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    const response = await anthropic.messages.create({
      messages: [{ role: "user", content: prompt }],
      model: MODEL,
      max_tokens: 200,
      system:
        "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra",
    });

    const answer = (response.content[0] as TextBlock).text.trim();
    const projectId = uuidv4();
    const projectPath = path.join(PROJECTS_DIR, projectId);

    fs.mkdirSync(projectPath, { recursive: true });

    fs.writeFileSync(
      path.join(projectPath, "README.txt"),
      `Project Type: ${answer}\n\nPrompt: ${prompt}`
    );

    if (answer === "react") {
      return res.json({
        prompts: [
          BASE_PROMPT,
          `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
        ],
        uiPrompts: [reactBasePrompt],
        projectId,
      });
    }

    if (answer === "node") {
      return res.json({
        prompts: [
          `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${nodeBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
        ],
        uiPrompts: [nodeBasePrompt],
        projectId,
      });
    }

    return res.status(403).json({ message: "Invalid AI response" });
  } catch (error: any) {
    console.error("Error in /template:", error?.message || error);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================
// /chat endpoint
// =========================
app.post("/chat", async (req: Request, res: Response) => {
  try {
    const messages = req.body.messages;

    if (!messages) {
      return res.status(400).json({ message: "Messages are required" });
    }

    const response = await anthropic.messages.create({
      messages,
      model: MODEL,
      max_tokens: 8000,
      system: getSystemPrompt(),
    });

    // Try to save generated files to project if projectId is provided
    const projectId = req.body.projectId;

    if (projectId) {
      try {
        const responseText =
          (response.content[0] as TextBlock)?.text || "";

        const parsedSteps = parseXml(responseText);
        const projectPath = path.join(PROJECTS_DIR, projectId);

        const saveFiles = (filesList: any[], basePath: string): void => {
          filesList.forEach((file) => {
            const filePath = path.join(basePath, file.name);

            if (file.type === "folder") {
              if (!fs.existsSync(filePath)) {
                fs.mkdirSync(filePath, { recursive: true });
              }
              if (file.children?.length > 0) {
                saveFiles(file.children, filePath);
              }
            } else if (file.type === "file") {
              fs.writeFileSync(filePath, file.content || "");
            }
          });
        };

        const filesFromSteps = parsedSteps
          .filter((step: any) => step.type === "CreateFile")
          .map((step: any) => ({
            name: step.path?.split("/").pop() || "file",
            type: "file",
            content: step.code,
          }));

        if (filesFromSteps.length > 0) {
          saveFiles(filesFromSteps, projectPath);
        }
      } catch (fileError) {
        console.warn(
          "Warning: Could not save generated files:",
          fileError
        );
      }
    }

    res.json({
      response: (response.content[0] as TextBlock)?.text,
    });
  } catch (error: any) {
    console.error("Error in /chat:", error?.message || error);
    res.status(500).json({ message: "Chat error" });
  }
});

// =========================
// /save-project endpoint
// =========================
app.post("/save-project", async (req: Request, res: Response) => {
  try {
    const { projectId, files } = req.body;
    const projectPath = path.join(PROJECTS_DIR, projectId);

    const saveFiles = (filesList: any[], basePath: string): void => {
      filesList.forEach((file) => {
        const filePath = path.join(basePath, file.name);

        if (file.type === "folder") {
          if (!fs.existsSync(filePath)) {
            fs.mkdirSync(filePath, { recursive: true });
          }
          if (file.children?.length > 0) {
            saveFiles(file.children, filePath);
          }
        } else if (file.type === "file") {
          fs.writeFileSync(filePath, file.content || "");
        }
      });
    };

    if (files && Array.isArray(files)) {
      saveFiles(files, projectPath);
    }

    res.json({ message: "Project saved successfully", projectId });
  } catch (error) {
    console.error("Error saving project:", error);
    res.status(500).json({ message: "Save error" });
  }
});

// =========================
// /download endpoint
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
        fs.unlinkSync(zipPath);
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
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
