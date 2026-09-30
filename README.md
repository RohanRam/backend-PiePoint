# PiePoint AI Backend (Groq)

Express server that proxies Groq API calls for the PiePoint Android app.  
The Android app **never** holds the Groq API key — all AI requests go through this server.

## Quick Start

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Set your Groq API key
cp .env.example .env
# Edit .env and paste your API key from https://console.groq.com/

# 3. Run the server
npm run dev          # with auto-reload (Node 18.11+)
# — or —
npm start            # without auto-reload
```

The server starts on **http://localhost:3000** by default.

## Endpoints

### `GET /health`
Health check. Returns menu item counts, provider (`groq`), and active model.

```bash
curl http://localhost:3000/health
```

### `GET /menu`
Returns the full menu as JSON.

```bash
curl http://localhost:3000/menu
```

### `POST /create-pizza`
Build a custom pizza from a natural-language description using Groq's high-speed inference.

**Request:**
```bash
curl -X POST http://localhost:3000/create-pizza \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"spicy vegetarian pizza under 400 rupees\"}"
```

**Response:**
```json
{
  "pizza": {
    "name": "Fiery Garden Delight",
    "crust": { "id": "c1", "name": "Classic", "price": 0 },
    "sauce": { "id": "s2", "name": "Spicy Arrabbiata", "price": 29 },
    "cheese": { "id": "ch1", "name": "Mozzarella", "price": 0 },
    "toppings": [
      { "id": "t10", "name": "Jalapeño", "emoji": "🌶️", "price": 39 },
      { "id": "t6",  "name": "Bell Pepper", "emoji": "🫑", "price": 39 },
      { "id": "t3",  "name": "Mushroom", "emoji": "🍄", "price": 49 }
    ],
    "size": { "id": "MEDIUM", "label": "M", "inches": 10, "priceModifier": 50 },
    "price": 355
  }
}
```

**More examples:**
```bash
# Extra cheesy pizza
curl -X POST http://localhost:3000/create-pizza \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"extra cheesy large pizza for a party\"}"

# Budget-friendly
curl -X POST http://localhost:3000/create-pizza \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"cheapest small veg pizza\"}"
```

### `POST /chat`
Conversational chat & recommendations. The model responds with JSON containing a `reply` and an optional `pizza` object.

**Request:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "What crusts do you have and can you build me a spicy veg pizza?" }
    ]
  }'
```

**Response:**
```json
{
  "reply": "We offer 5 great crusts: Classic, Thin & Crispy, Cheese Burst, Whole Wheat, and Stuffed Crust! Here's a fiery vegetarian pizza I made with Spicy Arrabbiata sauce and Jalapeños! 🌶️🍕",
  "suggestedPizza": {
    "name": "Fire & Herb Veggie",
    "crust": { "id": "c1", "name": "Classic", "price": 0 },
    "sauce": { "id": "s2", "name": "Spicy Arrabbiata", "price": 29 },
    "cheese": { "id": "ch1", "name": "Mozzarella", "price": 0 },
    "toppings": [
      { "id": "t10", "name": "Jalapeño", "emoji": "🌶️", "price": 39 },
      { "id": "t6",  "name": "Bell Pepper", "emoji": "🫑", "price": 39 }
    ],
    "size": { "id": "MEDIUM", "label": "M", "inches": 10, "priceModifier": 50 },
    "price": 306
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | ✅ | — | Your Groq API key from https://console.groq.com/ |
| `PORT` | — | `3000` | Server port |
| `GROQ_MODEL` | — | `llama-3.3-70b-versatile` | Groq model to use |

## How Pricing Works

Prices are **always** calculated server-side from `menu.json`. The AI is never trusted for prices.

```
price = customBasePrice(₹149)
      + size.priceModifier
      + crust.price
      + sauce.price
      + cheese.price
      + Σ (topping.price × qty)
```

If the AI returns an unknown item, the server either fuzzy-matches it or falls back to a safe default. In `/chat`, if core pizza components cannot be resolved, the pizza suggestion is dropped and noted in the conversational reply.

## Rate Limits & Resilience

- **30 requests/minute** per IP address across all AI endpoints.
- Automatic **single retry** if response JSON fails to parse.
- Clear, friendly `429` rate-limit errors.
- Prompt length capped at **500 characters**.
