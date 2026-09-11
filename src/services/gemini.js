const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Google's free-tier quotas and model availability have been shifting
// under us: a flagship model got throttled to 20 requests/day, and an
// established model ("gemini-2.5-flash") was abruptly retired for new API
// keys entirely (404 "no longer available to new users"). Rather than
// pin to one model and risk another surprise outage, try a short chain of
// models in order — GEMINI_MODEL can override with a comma-separated list.
// Flash-Lite variants currently carry much higher free-tier daily quotas
// (~1,500/day) than the flagship Flash models (as low as 20/day), so they
// lead the list.
const MODEL_CHAIN = (process.env.GEMINI_MODEL || "gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

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

  const config = {
    systemInstruction,
    maxOutputTokens: 800,
    responseMimeType: "application/json",
    // This task is simple extraction/formatting, not reasoning — disable
    // "thinking" so its hidden tokens don't eat into maxOutputTokens and
    // truncate the actual JSON reply before it finishes.
    thinkingConfig: { thinkingBudget: 0 },
  };

  const response = await generateWithFallback({ contents, config });

  return parseModelJson(response.text || "");
}

// Tries each model in MODEL_CHAIN in order. Within a model, transient
// errors (503 overloaded, 429 rate-limited-per-minute) get a couple of
// quick retries. A model that's out of daily quota (429 with no quick
// recovery) or no longer available (404) is abandoned in favor of the
// next model in the chain, so one model's bad day doesn't take the bot
// down — it only fully fails if every model in the chain does.
async function generateWithFallback({ contents, config }, modelIndex = 0) {
  const model = MODEL_CHAIN[modelIndex];
  if (!model) {
    throw new Error("All configured Gemini models failed (quota exhausted, unavailable, or overloaded).");
  }
  try {
    return await generateWithRetry({ model, contents, config });
  } catch (err) {
    const isRetryable404or429 = err && (err.status === 404 || err.status === 429);
    if (isRetryable404or429 && modelIndex + 1 < MODEL_CHAIN.length) {
      console.warn(`Gemini model "${model}" failed (${err.status}), falling back to "${MODEL_CHAIN[modelIndex + 1]}"`);
      return generateWithFallback({ contents, config }, modelIndex + 1);
    }
    throw err;
  }
}

// Gemini's free tier occasionally returns 503 ("model overloaded") or 429
// ("rate limited") during high-demand periods — both are transient, not
// real failures, so retry a couple of times with backoff before giving up
// (and letting generateWithFallback try the next model in the chain).
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

// The model is asked for pure JSON (and told to via responseMimeType), but
// this is parsed defensively in case it still wraps it in prose or a code
// fence.
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
    const trimmed = text.trim();
    // If it looks like it was trying to be JSON (e.g. truncated mid-object),
    // showing it raw to the customer is worse than a generic message.
    const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    return {
      reply: !looksLikeJson && trimmed ? trimmed : "Sorry, I didn't quite catch that — could you rephrase?",
      productIds: [],
    };
  }
}

module.exports = { getRecommendations };
