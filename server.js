// ─── PiePoint AI Backend ─────────────────────────────────────────────────────
// Express server proxying Groq API for pizza building and chat.
// The Android app NEVER holds the API key — all AI calls go through here.
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Groq from 'groq-sdk';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const menu = require('./menu.json');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_PROMPT_LENGTH = 500;
const MAX_CHAT_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 1000;

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.warn('⚠️  GROQ_API_KEY is not set.');
}

const groq = new Groq({
  apiKey: apiKey || 'missing-key',
});

// ─── Express Setup ───────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute window
  max: 30,                // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
});

// ─── Menu Helpers ────────────────────────────────────────────────────────────

function findMenuItem(key, items) {
  if (!key || typeof key !== 'string') return null;
  const lower = key.toLowerCase().trim();

  const byId = items.find((item) => item.id.toLowerCase() === lower);
  if (byId) return byId;

  const exact = items.find((item) => item.name.toLowerCase() === lower);
  if (exact) return exact;

  const normalized = lower.replace(/&/g, 'and').replace(/\s+/g, ' ');
  const norm = items.find(
    (item) => item.name.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ') === normalized
  );
  if (norm) return norm;

  const partial = items.find(
    (item) =>
      item.name.toLowerCase().includes(lower) ||
      lower.includes(item.name.toLowerCase())
  );
  return partial || null;
}

function findSize(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return null;
  const lower = sizeStr.toLowerCase().trim();
  return menu.sizes.find(
    (s) => s.id.toLowerCase() === lower || s.label.toLowerCase() === lower
  );
}

function buildMenuSummary() {
  const crusts = menu.crusts.map((c) => `  - id: "${c.id}", name: "${c.name}"`).join('\n');
  const sauces = menu.sauces.map((s) => `  - id: "${s.id}", name: "${s.name}"`).join('\n');
  const cheeses = menu.cheeses.map((ch) => `  - id: "${ch.id}", name: "${ch.name}"`).join('\n');
  const toppings = menu.toppings.map((t) => `  - id: "${t.id}", name: "${t.name}" ${t.emoji}`).join('\n');
  const sizes = menu.sizes.map((s) => `  - id: "${s.id}" (${s.inches}")`).join('\n');
  const pizzas = menu.pizzas.map((p) => `  - "${p.name}": ${p.description}`).join('\n');

  return `
CRUSTS:
${crusts}
SAUCES:
${sauces}
CHEESES:
${cheeses}
TOPPINGS:
${toppings}
SIZES:
${sizes}
SIGNATURE PIZZAS:
${pizzas}
`;
}

const menuSummary = buildMenuSummary();

// ─── Tools Definition ────────────────────────────────────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "build_pizza",
      description: "Builds a custom pizza based on user preferences. Call this when the user asks for a pizza to be built, customized, or recommends a specific pizza.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "A creative, appetizing name for the pizza." },
          crustId: { type: "string", description: "Exact ID of the crust from the menu (e.g., 'c1', 'c2')." },
          sauceId: { type: "string", description: "Exact ID of the sauce from the menu (e.g., 's1', 's2')." },
          cheeseId: { type: "string", description: "Exact ID of the cheese from the menu (e.g., 'ch1', 'ch2')." },
          toppings: {
            type: "array",
            description: "Array of toppings to add. Keep under 5 toppings total.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Exact ID of the topping from the menu (e.g., 't1', 't2')." },
                qty: { type: "number", description: "Quantity of this topping (1 to 3)." }
              },
              required: ["id", "qty"]
            }
          },
          size: { type: "string", description: "Size of the pizza. Must be SMALL, MEDIUM, or LARGE. Default to MEDIUM if unspecified." }
        },
        required: ["name", "crustId", "sauceId", "cheeseId", "toppings", "size"]
      }
    }
  }
];

// ─── System Prompts ──────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are Pie, the cheerful and knowledgeable pizza concierge for PiePoint.
Your job is to help customers explore the menu, answer dietary questions, and build custom pizzas.

MENU:
${menuSummary}

CRITICAL RULES:
1. If the user wants a pizza built, customized, or recommended, YOU MUST CALL THE 'build_pizza' FUNCTION.
2. Use EXACT IDs from the menu above. Never invent items.
3. Dietary Rules (Veg vs Non-Veg):
   - ALL toppings are considered VEG EXCEPT Pepperoni (t2) and Bacon (t9).
   - If a user asks for a "Non-Veg" pizza, YOU MUST include Pepperoni (t2) and/or Bacon (t9).
   - If a user asks for a "Veg" or "Vegetarian" pizza, YOU MUST NOT include Pepperoni (t2) or Bacon (t9).
   - Spicy = MUST include Jalapeño (t10) and/or Spicy Arrabbiata (s2) sauce.
4. Customizing an existing pizza:
   - If the system notes that you recently built a pizza, use that exact pizza as the baseline if the user asks for modifications (e.g., "add extra cheese", "change crust to thin").
5. Be concise, friendly, and use emojis. Do NOT output raw JSON in your text replies.`;

// ─── Validation Helpers ──────────────────────────────────────────────────────

function validateAndPriceStructuredPizza(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const crust = findMenuItem(raw.crustId || raw.crust, menu.crusts);
  const sauce = findMenuItem(raw.sauceId || raw.sauce, menu.sauces);
  const cheese = findMenuItem(raw.cheeseId || raw.cheese, menu.cheeses);
  const size = findSize(raw.size);

  if (!crust || !sauce || !cheese || !size) {
    return null;
  }

  const validToppings = [];
  const rawToppings = Array.isArray(raw.toppings) ? raw.toppings : [];
  for (const item of rawToppings.slice(0, 10)) {
    const toppingKey = typeof item === 'string' ? item : (item?.id || item?.name);
    const qty = typeof item === 'object' && typeof item?.qty === 'number' ? Math.max(1, Math.min(3, item.qty)) : 1;
    const topping = findMenuItem(toppingKey, menu.toppings);
    if (topping) validToppings.push({ topping, qty });
  }

  const toppingsPrice = validToppings.reduce((sum, item) => sum + (item.topping.price * item.qty), 0);
  const price = menu.customBasePrice + size.priceModifier + crust.price + sauce.price + cheese.price + toppingsPrice;

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'AI Custom Pizza',
    crust: { id: crust.id, name: crust.name, price: crust.price },
    sauce: { id: sauce.id, name: sauce.name, price: sauce.price },
    cheese: { id: cheese.id, name: cheese.name, price: cheese.price },
    toppings: validToppings.map((item) => ({
      id: item.topping.id,
      name: item.topping.name,
      emoji: item.topping.emoji,
      price: item.topping.price * item.qty,
    })),
    size: { id: size.id, label: size.label, inches: size.inches, priceModifier: size.priceModifier },
    price,
  };
}

// ─── AI Invocation Logic ─────────────────────────────────────────────────────

async function completeWithToolCall(messages, requireTool = false, maxTokens = 1024, temperature = 0.6) {
  let attempts = 0;
  while (attempts < 2) {
    attempts++;

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages,
      tools: tools,
      tool_choice: requireTool ? { type: "function", function: { name: "build_pizza" } } : "auto",
      max_tokens: maxTokens,
      temperature,
    });

    const message = completion.choices?.[0]?.message;
    if (!message) {
      if (attempts < 2) continue;
      throw new Error('EMPTY_RESPONSE');
    }

    let reply = message.content || "";
    let rawPizza = null;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls.find(t => t.function.name === 'build_pizza');
      if (toolCall) {
        try {
          rawPizza = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.warn(`[groq] Tool call JSON parse error (attempt ${attempts}):`, parseError.message);
          if (attempts < 2) continue;
          throw new Error('INVALID_JSON');
        }
      }
    }

    // Fallback if LLM triggers tool but forgets conversational text
    if (!reply && rawPizza) {
      reply = "I've built a custom pizza for you based on your request! How does this look?";
    } else if (!reply && !rawPizza) {
       reply = "I'm here to help you build your favorite pizza! 🍕";
    }

    return { reply, rawPizza };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.send('🍕 PiePoint AI Backend is running successfully!'));

app.get('/health', (_req, res) => res.json({ status: 'ok', provider: 'groq', model: MODEL }));

app.get('/menu', (_req, res) => res.json(menu));

app.post('/chat', apiLimiter, async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '"messages" must be a non-empty array.' });
    }

    const groqMessages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

    for (const msg of messages) {
      if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) continue;
      if (msg.role === 'system') continue;

      const role = msg.role === 'user' ? 'user' : 'assistant';
      let text = msg.content.slice(0, MAX_MESSAGE_LENGTH);

      // Inject previously built pizza context into the model's history so it remembers what it built
      if (role === 'assistant' && msg.pizza && typeof msg.pizza === 'object') {
          const pizzaSummary = JSON.stringify({
              crust: msg.pizza.crust?.id,
              sauce: msg.pizza.sauce?.id,
              cheese: msg.pizza.cheese?.id,
              toppings: msg.pizza.toppings?.map(t => t.id),
              size: msg.pizza.size?.id
          });
          text += `\n[System Note: I built this pizza for the user: ${pizzaSummary}]`;
      }

      groqMessages.push({
        role,
        content: text,
      });
    }

    if (groqMessages.length <= 1) {
       return res.status(400).json({ error: 'No valid message content provided.' });
    }

    console.log(`[chat] processing ${groqMessages.length - 1} message(s)...`);

    const { reply: aiContent, rawPizza } = await completeWithToolCall(groqMessages, false, 1024, 0.6);

    let reply = aiContent;
    let suggestedPizza = null;

    if (rawPizza) {
      const validated = validateAndPriceStructuredPizza(rawPizza);
      if (validated) {
        suggestedPizza = validated;
      } else {
        reply += "\n\n*(Note: Some ingredients in the requested pizza weren't available in our current menu, so I couldn't build that exact pizza. Feel free to ask what ingredients we have!)*";
      }
    }

    console.log(`[chat] → reply: "${reply.slice(0, 50)}...", pizza: ${suggestedPizza ? suggestedPizza.name : 'null'}`);
    return res.json({ reply, suggestedPizza, pizza: suggestedPizza });

  } catch (err) {
    console.error('[chat] Error:', err);
    return handleApiError(err, res);
  }
});

app.post('/create-pizza', apiLimiter, async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
          return res.status(400).json({ error: 'Valid "prompt" is required.' });
        }
        if (prompt.length > MAX_PROMPT_LENGTH) {
            return res.status(400).json({ error: `Prompt too long. Maximum ${MAX_PROMPT_LENGTH} characters.` });
        }

        const groqMessages = [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt.trim() },
        ];

        const { rawPizza } = await completeWithToolCall(groqMessages, true, 512, 0.5);
        const pizza = validateAndPriceStructuredPizza(rawPizza || {});

        if (!pizza) throw new Error("Failed to validate pizza from model");

        return res.json({ pizza, warnings: undefined });
    } catch (err) {
        console.error('[create-pizza] Error:', err.message || err);
        return handleApiError(err, res);
    }
});

function handleApiError(err, res) {
  if (err?.status === 429 || err?.message?.includes('429') || err?.error?.code === 'rate_limit_exceeded') {
    return res.status(429).json({ error: 'API rate limit reached. Please wait a moment and try again.' });
  }
  if (err?.status === 401 || err?.message?.includes('401')) {
    return res.status(500).json({ error: 'Invalid API key. Check backend/.env.' });
  }
  if (err?.message === 'INVALID_JSON' || err?.message === 'EMPTY_RESPONSE') {
    return res.status(502).json({ error: 'AI encountered an issue processing the request. Please try again.' });
  }
  // Temporary: Send actual error message for debugging
  return res.status(500).json({ error: 'Internal server error.', details: err?.message, stack: err?.stack, raw: JSON.stringify(err) });
}

// ─── Global error handler ────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Global Internal server error.', details: err?.message, stack: err?.stack });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('🍕 PiePoint AI Backend (Groq Function Calling)');
  console.log(`   http://localhost:${PORT}`);
  console.log('');
  console.log('   POST /create-pizza  — Direct natural-language pizza builder (Forced Tool)');
  console.log('   POST /chat          — Conversational chat with Tools');
  console.log('   GET  /menu          — View the full menu');
  console.log('   GET  /health        — Health check');
  console.log('');
  console.log(`   Model: ${MODEL}`);
  console.log('');
});
