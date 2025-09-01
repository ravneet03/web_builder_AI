require("dotenv").config();
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { BASE_PROMPT, getSystemPrompt } from "./prompts";
import { TextBlock } from "@anthropic-ai/sdk/resources";
import { basePrompt as nodeBasePrompt } from "./default/node";
import { basePrompt as reactBasePrompt } from "./default/react";
import cors from "cors";

const anthropic = new Anthropic();
const app = express();

app.use(cors());
app.use(express.json());

app.post("/template", async (req, res) => {
  const prompt = req.body.prompt;

  try {
    const response = await anthropic.messages.create({
      messages: [{ role: "user", content: prompt }],
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 200,
      system:
        "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra",
    });

    const answer = (response.content[0] as TextBlock).text;

    if (answer === "react") {
      return res.json({
        prompts: [
          BASE_PROMPT,
          `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
        ],
        uiPrompts: [reactBasePrompt],
      });
    }

    if (answer === "node") {
      return res.json({
        prompts: [
          `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`,
        ],
        uiPrompts: [nodeBasePrompt],
      });
    }

    return res.status(403).json({ message: "You cant access this" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages;

    const response = await anthropic.messages.create({
      messages,
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8000,
      system: getSystemPrompt(),
    });

    console.log("response");
    res.json({
      response: (response.content[0] as TextBlock)?.text,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Chat error" });
  }
});

// ✅ Use Render’s dynamic PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
