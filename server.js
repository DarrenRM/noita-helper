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

// Conversation state for follow-up questions (single-user for now)
let conversationState = {
    awaitingFollowUp: false,
    pendingQuest: null,
    pendingStep: null,
    originalQuery: null
};

function resetConversationState() {
    conversationState = {
        awaitingFollowUp: false,
        pendingQuest: null,
        pendingStep: null,
        originalQuery: null
    };
}

// Load context data and quests
const questsPath = path.join(__dirname, 'data', 'quests.json');
const contextPath = path.join(__dirname, 'data', 'context.md');

// Function to reload quest data (called on each request to pick up changes)
function loadQuestData() {
    let contextData = "";
    let questsData = null;
    try {
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
    return { contextData, questsData };
}

// Initial load
let { contextData, questsData } = loadQuestData();

// Get prerequisite item for a quest step (what they need BEFORE this step)
function getPrerequisiteForStep(questId, stepNum) {
    if (!questsData) return null;
    const quest = questsData.quests.find(q => q.id === questId);
    if (!quest) return null;
    
    // Find the previous step's task - that's what they need to have done
    const prevStep = quest.steps.find(s => s.step === stepNum - 1);
    if (prevStep) {
        return prevStep.task;
    }
    return null;
}

// Generate a non-spoilery clarifying question based on what the player mentioned
// These are intentionally GENERIC and reveal nothing about what they should have done
function generateClarifyingQuestion(query) {
    const questions = [
        "What led you to discover this?",
        "How did you find this? What were you doing before?",
        "What else have you discovered that might be connected to this?"
    ];
    // Pick based on query length/complexity for variety
    return questions[query.length % questions.length];
}

// Get the step 1 hint for a quest (safe fallback)
function getStep1Hint(questId) {
    if (!questsData) return null;
    const quest = questsData.quests.find(q => q.id === questId);
    if (quest && quest.steps.length > 0) {
        const step1 = quest.steps.find(s => s.step === 1);
        return step1 ? step1.hint : null;
    }
    return null;
}

// Get hint for a specific quest and step
function getHintForStep(questId, stepNum) {
    if (!questsData) return null;
    const quest = questsData.quests.find(q => q.id === questId);
    if (quest) {
        const step = quest.steps.find(s => s.step === stepNum);
        return step ? step.hint : null;
    }
    return null;
}

app.post('/api/hint', async (req, res) => {
    try {
        // Reload quest data on each request to pick up changes
        ({ contextData, questsData } = loadQuestData());
        
        const { query, isFollowUp, previousQuery } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Query is required" });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY is not set in .env file" });
        }

        // Handle follow-up responses
        if (isFollowUp && conversationState.awaitingFollowUp) {
            // Get the prerequisite for context
            const prerequisite = getPrerequisiteForStep(conversationState.pendingQuest, conversationState.pendingStep);
            
            const followUpPrompt = `
You are a Noita Quest Helper analyzing a player's follow-up response.

IMPORTANT: Quests in Noita are NOT sequential. A player can discover things from Quest 5 Step 3 without having done Quest 5 Step 1 or 2. They can find Quest 6 items without completing Quest 5. Do NOT assume progression.

QUEST DATA:
${JSON.stringify(questsData, null, 2)}

Original player query: "${conversationState.originalQuery}"
We identified this as potentially Quest ${conversationState.pendingQuest}, Step ${conversationState.pendingStep}.
${prerequisite ? `The prerequisite for this step is: "${prerequisite}"` : 'This is step 1, no prerequisite.'}

The player was asked about their progress and responded: "${query}"

Analyze ONLY whether the player's response indicates they have the SPECIFIC prerequisite item or completed the SPECIFIC prerequisite action for this step.

- If they clearly have/did the prerequisite → confirmed: true
- If they DON'T have/did the prerequisite OR are unclear → confirmed: false
- Do NOT infer completion of other steps or quests from their response
- Finding something doesn't mean they know what to do with it

Return ONLY valid JSON (no explanation):
{
  "confirmed": boolean,
  "adjusted_step": number | null
}
`;

            try {
                const result = await model.generateContent(followUpPrompt);
                const response = await result.response;
                const text = response.text();
                
                let followUpResponse;
                try {
                    // Try to extract JSON from the response (handle cases where AI includes explanatory text)
                    let cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                    
                    // Look for JSON object boundaries if parsing fails
                    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        cleanedText = jsonMatch[0];
                    }
                    
                    followUpResponse = JSON.parse(cleanedText);
                } catch (e) {
                    // Silently handle parsing errors - this is expected when AI includes reasoning
                    // The fallback response is safe and the UI will still work
                    followUpResponse = { confirmed: false, adjusted_step: null };
                }

                let hintText;
                let finalStep;
                const questId = conversationState.pendingQuest;

                if (followUpResponse.confirmed) {
                    // Player confirmed they've done prerequisites, give them the hint they need
                    finalStep = followUpResponse.adjusted_step || conversationState.pendingStep;
                    hintText = getHintForStep(questId, finalStep);
                } else {
                    // Player hasn't done prerequisites, give step 1 hint
                    finalStep = 1;
                    hintText = getStep1Hint(questId);
                }

                if (!hintText) {
                    hintText = "The gods sense you may have discovered something out of order. Retrace your steps - there may be something you missed.";
                }

                // Clear conversation state
                resetConversationState();

                return res.json({
                    type: "hint",
                    quest_id: questId,
                    current_step: finalStep,
                    confidence: followUpResponse.confirmed ? "high" : "medium",
                    response: hintText
                });

            } catch (error) {
                console.error("Error processing follow-up:", error);
                resetConversationState();
                return res.status(500).json({ error: "Error processing follow-up", details: error.message });
            }
        }

        // Reset state if this is a new query (not a follow-up)
        resetConversationState();

        // Initial query - identify quest and step
        const prompt = `
You are a Noita Quest Helper. Your goal is to identify which quest a player is on based on their description.
You have access to the following context about Noita quests and game data:

${contextData}

The player says: "${query}"

CRITICAL: Noita quests are NOT sequential. Players can:
- Discover things from Quest 5 Step 3 without completing Steps 1-2
- Find Quest 6 items without touching Quest 5
- Stumble onto locations/items completely out of order
Do NOT assume that finding something from Step N means they completed Steps 1 through N-1.

Instructions:
1. Identify what specific item, location, or discovery the player is describing.
2. Match it to the SPECIFIC step where that item/location/discovery is the goal or relates to.
3. Return the step number for WHAT THEY FOUND, not what they should have done before.
   - Step numbers start at 1 (not 0) - match the step numbers exactly as they appear in the quest data
   - If they say "I found X but don't know what to do" → return the step where X is the goal
   - If they say "I just finished X, what's next?" → return the next step number
4. If you cannot determine the quest or step with high confidence, return null values.
5. Do NOT assume they have prerequisite items or completed earlier steps.

Return ONLY valid JSON (no explanation):
{
  "quest_id": number | null,
  "current_step": number | null,
  "confidence": "high" | "medium" | "low"
}
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Attempt to parse JSON from the response
        let aiResponse;
        try {
            // Try to extract JSON from the response (handle cases where AI includes explanatory text)
            let cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            
            // Look for JSON object boundaries if parsing fails
            const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanedText = jsonMatch[0];
            }
            
            aiResponse = JSON.parse(cleanedText);
        } catch (e) {
            // Silently handle parsing errors - this is expected when AI includes reasoning
            // The fallback response is safe and the UI will still work
            aiResponse = { 
                quest_id: null, 
                current_step: null, 
                confidence: "low"
            };
        }

        // Check if we identified a mid-quest step (step > 1)
        // If so, ask a clarifying question instead of giving the hint directly
        if (aiResponse.quest_id !== null && aiResponse.current_step !== null && aiResponse.current_step > 1) {
            // Store state for follow-up
            conversationState = {
                awaitingFollowUp: true,
                pendingQuest: aiResponse.quest_id,
                pendingStep: aiResponse.current_step,
                originalQuery: query
            };

            // Ask a generic question that reveals nothing but gathers context
            const question = generateClarifyingQuestion(query);

            return res.json({
                type: "question",
                quest_id: aiResponse.quest_id,
                current_step: aiResponse.current_step,
                confidence: aiResponse.confidence,
                response: question
            });
        }

        // Give hint for the NEXT step (since AI identified what they found/completed)
        let hintText = null;
        let nextStep = null;
        if (questsData && aiResponse.quest_id !== null && aiResponse.current_step !== null) {
            nextStep = aiResponse.current_step + 1;
            hintText = getHintForStep(aiResponse.quest_id, nextStep);
            
            // If no hint for next step, they may have completed the quest
            if (!hintText) {
                hintText = "The gods sense you have reached the end of this path. The final steps are yours to take.";
            }
        }

        // If no hint found, provide a fallback message
        if (!hintText) {
            if (aiResponse.quest_id === null || aiResponse.current_step === null) {
                hintText = "The gods are unclear. Can you describe what you've done or where you are in more detail?";
            } else {
                hintText = "The gods cannot find guidance for this step. Perhaps the path is not yet clear.";
            }
        }

        res.json({
            type: "hint",
            quest_id: aiResponse.quest_id,
            current_step: nextStep || aiResponse.current_step,
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

