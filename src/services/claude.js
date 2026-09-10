const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

// Asks Claude to play shopping assistant over a shortlisted slice of the
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

  const system = `You are a friendly, concise shopping assistant embedded as a chat widget on the Shopify store "${shopName}".
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

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    messages,
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseModelJson(text);
}

// The model is instructed to return pure JSON, but is defensively parsed
// in case it wraps it in prose or a code fence.
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
