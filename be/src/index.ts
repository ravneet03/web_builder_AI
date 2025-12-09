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
import { parseXml } from "./steps";105

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
      // 👇 IMPORTANT: use a real Anthropic model id
      model: "claude-3-5-haiku-20241022",
      max_tokens: 200,
      system:
        "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra",
    });

    const answer = (response.content[0] as TextBlock).text; // "react" or "node"
    const projectId = uuidv4(); // generate unique project ID
    const projectPath = path.join(PROJECTS_DIR, projectId);
    fs.mkdirSync(projectPath);

    // Save base prompt file for demo (can save full project later)
    fs.writeFileSync(
      path.join(projectPath, "README.txt"),
      `Project Type: ${answer}\n\nPrompt: ${prompt}`
    );

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
88, async (req: Request, res: Response) => {
  try {
    const messages = req.body.messages;

    const response = await anthropic.messages.create({
      messages,
      // 👇 same correct model id here too
      model: "claude-3-5-haiku-20241022",
      max_tokens: 8000,
      system: getSystemPrompt(),
    });


        // 110
    to project if projectId is provided
    const projectId = req.body.projectId;
    if (projectId) {
      try {
        const responseText = (response.content[0] as TextBlock)?.text || '';
        const parsedSteps = parseXml(responseText);
        const projectPath = path.join(PROJECTS_DIR, projectId);
        
        // Save each file from the parsed steps
        const saveFiles = (filesList: any[], basePath: string): void => {
          filesList.forEach(file => {
            const filePath = path.join(basePath, file.name);
            if (file.type === 'folder') {
              if (!fs.existsSync(filePath)) {
                fs.mkdirSync(filePath, { recursive: true });
              }
              if (file.children && file.children.length > 0) {
                saveFiles(file.children, filePath);
              }
            } else if (file.type === 'file') {
              fs.writeFileSync(filePath, file.content || '');
            }
          });
        };
        
        // Extract files from steps
        const filesFromSteps = parsedSteps
          .filter((step: any) => step.type === 'CreateFile')
          .map((step: any) => ({
            name: step.path?.split('/').pop() || 'file',
            type: 'file',
            content: step.code
          }));
        
        if (filesFromSteps.length > 0) {
          saveFiles(filesFromSteps, projectPath);
        }
      } catch (fileError) {
        console.warn('Warning: Could not save generated files to disk:', fileError);
        // Continue anyway - this is not critical for the response
      }
    }

    res.json({
      response: (response.content[0] as TextBlock)?.text,
    });
  } catch (error) {
    console.error("Error in /chat:", error);
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
    
    // Recursive function to save files
    const saveFiles = (filesList: any[], basePath: string): void => {
      filesList.forEach(file => {
        const filePath = path.join(basePath, file.name);
        if (file.type === 'folder') {
          if (!fs.existsSync(filePath)) {
            fs.mkdirSync(filePath, { recursive: true });
          }
          if (file.children && file.children.length > 0) {
            saveFiles(file.children, filePath);
          }
        } else if (file.type === 'file') {
          fs.writeFileSync(filePath, file.content || '');
        }
      });
    };
    
    // Save all files
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
// /download/:projectId endpoint
// =========================
app.get("/download/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const projectPath = path.join(PROJECTS_DIR, projectId);

    if (!fs.existsSync(projectPath)) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    const zipPath = path.join(PROJECTS_DIR, `${projectId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, `project-${projectId}.zip`, (err: Error | undefined) => {
        if (err) console.error("Error sending ZIP:", err);
        fs.unlinkSync(zipPath); // clean up
      });
    });

    archive.on("error", (err: Error) => {
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
