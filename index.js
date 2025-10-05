import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function isRisky(text = "") {
  const re = /\b(suicide|kill myself|end my life|hurt myself|die by|die\W|self[- ]?harm|kill myself)\b/i;
  return re.test(text);
}

// defensive extractor for OpenAI replies (works across SDK response shapes)
function extractAIText(resp) {
  try {
    if (!resp) return null;
    // common new SDK shape
    if (resp.choices && resp.choices[0]) {
      const c = resp.choices[0];
      if (c.message && (c.message.content || c.message.content === "")) return c.message.content;
      if (typeof c.text === "string") return c.text;
      if (c.delta && c.delta.content) return c.delta.content;
    }
    // older text completions shape
    if (resp.data && resp.data.choices && resp.data.choices[0]) {
      const c = resp.data.choices[0];
      if (c.text) return c.text;
      if (c.message && c.message.content) return c.message.content;
    }
  } catch (e) {
    console.warn("extractAIText error:", e);
  }
  return null;
}

app.post("/webhook", async (req, res) => {
  try {
    const queryText = req.body.queryResult?.queryText ?? "";
    const knowledgeAnswers = req.body.queryResult?.knowledgeAnswers?.answers ?? [];

    console.log("Incoming query:", queryText);
    // Safety short-circuit
    if (isRisky(queryText)) {
      console.log("Risk detected → sending crisis message");
      return res.json({
        fulfillmentText:
`I'm really sorry you're feeling this way. You don't have to face this alone. 
Please reach out to someone you trust, or call AASRA at 91-9820466726 for support.`
      });
    }

    // Use top KB answer if confidence high
    const topAnswer = knowledgeAnswers[0];
    if (topAnswer && Number(topAnswer.matchConfidence) >= 0.8) {
      const kbText = String(topAnswer.answer).slice(0, 1200); // truncate to avoid huge token use
      console.log("KB answer present, enhancing using OpenAI (kb-enhance)");

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a concise, empathetic assistant. Keep answers accurate and do not add new factual claims beyond the KB." },
          { role: "user", content: `Polish and make more empathetic this answer (do not change facts): "${kbText}"` }
        ],
        max_tokens: 300,
        temperature: 0.5
      });

      const aiText = extractAIText(resp) ?? kbText;
      return res.json({ fulfillmentText: aiText });
    }

    // No strong KB answer — respond using ChatGPT
    console.log("No strong KB match → generating answer from scratch");
    const userPrompt = String(queryText).slice(0, 1200);

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content:
`You are a compassionate AI assistant specializing in mental health support.
Respond with empathy, clarity, and sensitivity. Avoid medical/diagnostic advice; provide coping strategies and encourage reaching out to professionals when appropriate.` },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const aiText = extractAIText(resp) ?? "Sorry, I couldn't generate an answer right now.";
    res.json({ fulfillmentText: aiText });

  } catch (error) {
    console.error("Webhook error:", error);
    res.json({ fulfillmentText: "I'm sorry, something went wrong. Please try again later." });
  }
});

app.get("/", (req, res) => {
  res.send("Mental Health Support Chatbot Webhook is running.");
});

app.listen(process.env.PORT || 9000, () =>
  console.log("Webhook running on port", process.env.PORT || 8080)
);
