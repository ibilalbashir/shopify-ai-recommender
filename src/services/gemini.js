const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Asks Gemini to play shopping assistant over a shortlisted slice of the
// store's catalog, and to answer with strict JSON so the widget can render
// product cards instead of having to parse free text.
async function getRecommendations({ shopName, userMessage, history, products }) {
  const catalogBlock = products
    .map(
      (p, i) =>
        `${i + 1}. id=${p.id} | ${p.title} | $${p.price ?? "?"} | type=${p.type || "n/a"} | tags=${p.tags.join(
          ", "
        )} | ${p.available ? "in stock" : "OUT OF STOCK"}\n   ${p.description}`
    )
    .join("\n");

  const systemInstruction = `You are a friendly, concise shopping assistant embedded as a chat widget on the Shopify store "${shopName}".
A customer will describe what they want, ask a question, or just say hi. Your job is to have a brief, natural
conversation and recommend real products from the catalog below when it makes sense to.

Rules:
- Only recommend products that appear in the CATALOG list below. Never invent products, prices, or ids.
- Prefer products marked "in stock". Only suggest an out-of-stock item if nothing suitable is in stock, and say so.
- Recommend at most 4 products per reply — quality over quantity.
- If the customer's message is a greeting or too vague to recommend anything yet, ask one short clarifying
  question (e.g. budget, use case, who it's for) instead of guessing, and return an empty recommendations list.
- If nothing in the catalog fits, say so honestly and suggest what to browse instead. Don't force a match.
- Keep "reply" short and conversational (1-3 sentences), like a helpful store employee, not a search engine.

CATALOG (id | title | price | type | tags | stock | description):
${catalogBlock}

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"reply": "string shown to the customer", "product_ids": [array of matching catalog ids, 0-4 items, most relevant first]}`;

  // Gemini uses "model" (not "assistant") for the AI's turn.
  const contents = [
    ...history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const response = await generateWithRetry({
    model: MODEL,
    contents,
    config: {
      systemInstruction,
      maxOutputTokens: 600,
      responseMimeType: "application/json",
    },
  });

  return parseModelJson(response.text || "");
}

// Gemini's free tier occasionally returns 503 ("model overloaded") or 429
// ("rate limited") during high-demand periods — both are transient, not
// real failures, so retry a couple of times with backoff before giving up.
async function generateWithRetry(params, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  try {
    return await ai.models.generateContent(params);
  } catch (err) {
    const isRetryable = err && (err.status === 503 || err.status === 429);
    if (isRetryable && attempt < MAX_ATTEMPTS) {
      const delayMs = 500 * 2 ** (attempt - 1); // 500ms, then 1000ms
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return generateWithRetry(params, attempt + 1);
    }
    throw err;
  }
}

function parseModelJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : text;
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : "Here's what I found for you.",
      productIds: Array.isArray(parsed.product_ids) ? parsed.product_ids : [],
    };
  } catch {
    return { reply: text.trim() || "Sorry, could you rephrase that?", productIds: [] };
  }
}

module.exports = { getRecommendations };
