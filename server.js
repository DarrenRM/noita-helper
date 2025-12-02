require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In development, disable caching for static files (always disable cache for easier development)
app.use(express.static('public', {
    setHeaders: (res, path) => {
        // Disable caching for all static files in development
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

// Load context data and quests
let contextData = "";
let questsData = null;
try {
    const questsPath = path.join(__dirname, 'data', 'quests.json');
    const contextPath = path.join(__dirname, 'data', 'context.md');
    
    let questsJson = "{}";
    let contextMd = "";

    if (fs.existsSync(questsPath)) {
        questsJson = fs.readFileSync(questsPath, 'utf8');
        questsData = JSON.parse(questsJson);
    }
    if (fs.existsSync(contextPath)) {
        contextMd = fs.readFileSync(contextPath, 'utf8');
    }
    
    contextData = `
QUEST DATA:
${questsJson}

GAME CONTEXT:
${contextMd}
`;
} catch (error) {
    console.error("Error loading data files:", error);
}

app.post('/api/hint', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Query is required" });
        }

        if (!process.env.GEMINI_API_KEY) {
             return res.status(500).json({ error: "GEMINI_API_KEY is not set in .env file" });
        }

        const prompt = `
You are a Noita Quest Helper. Your goal is to identify which quest a player is on based on their description.
You have access to the following context about Noita quests and game data:

${contextData}

The player says: "${query}"

Instructions:
1. Analyze the player's query to identify which quest they are on and what step they are currently WORKING ON or STUCK ON.
2. Return the step number they need guidance for - this is the step they are trying to complete, NOT the step after it.
   - Step numbers start at 1 (not 0) - match the step numbers exactly as they appear in the quest data
   - If they say "I found X but don't know what to do" → return the step where X is the goal
   - If they say "I just finished X, what's next?" → return the next step number
   - If they seem stuck partway through a step → return that step number
3. If you cannot determine the quest or step with high confidence, return null values.
4. It is important that we do not assume anything that will spoil the quest by giving them information beyond what they have discovered.
5. Return your response in JSON format:
   {
     "quest_id": number | null,
     "current_step": number | null,
     "confidence": "high" | "medium" | "low"
   }

IMPORTANT: Only return the quest_id and current_step. Do NOT generate hints or responses.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Attempt to parse JSON from the response
        let aiResponse;
        try {
            const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            aiResponse = JSON.parse(cleanedText);
        } catch (e) {
            console.error("Failed to parse JSON response:", text);
            aiResponse = { 
                quest_id: null, 
                current_step: null, 
                confidence: "low"
            };
        }

        // Look up the hint from quests.json
        let hintText = null;
        if (questsData && aiResponse.quest_id !== null && aiResponse.current_step !== null) {
            const quest = questsData.quests.find(q => q.id === aiResponse.quest_id);
            if (quest) {
                const step = quest.steps.find(s => s.step === aiResponse.current_step);
                if (step) {
                    hintText = step.hint;
                }
            }
        }

        // If no hint found, provide a fallback message
        if (!hintText) {
            if (aiResponse.quest_id === null || aiResponse.current_step === null) {
                hintText = "The spirits are unclear. Can you describe what you've done or where you are in more detail?";
            } else {
                hintText = "The spirits cannot find guidance for this step. Perhaps the path is not yet clear.";
            }
        }

        res.json({
            quest_id: aiResponse.quest_id,
            current_step: aiResponse.current_step,
            confidence: aiResponse.confidence,
            response: hintText
        });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Noita Helper server running at http://localhost:${port}`);
});

