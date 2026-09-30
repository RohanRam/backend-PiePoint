import 'dotenv/config';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const buildPizzaTool = {
  functionDeclarations: [
    {
      name: "build_pizza",
      description: "Builds a custom pizza based on user preferences. Call this when the user asks for a pizza to be built, customized, or recommends a specific pizza.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "A creative, appetizing name for the pizza." },
          crustId: { type: SchemaType.STRING, description: "Exact ID of the crust from the menu (e.g., 'c1', 'c2')." },
          sauceId: { type: SchemaType.STRING, description: "Exact ID of the sauce from the menu (e.g., 's1', 's2')." },
          cheeseId: { type: SchemaType.STRING, description: "Exact ID of the cheese from the menu (e.g., 'ch1', 'ch2')." },
          toppings: {
            type: SchemaType.ARRAY,
            description: "Array of toppings to add. Max 5.",
            items: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.STRING, description: "Exact ID of the topping from the menu (e.g., 't1', 't2')." },
                qty: { type: SchemaType.INTEGER, description: "Quantity of this topping (1 to 3)." }
              },
              required: ["id", "qty"]
            }
          },
          size: { type: SchemaType.STRING, description: "Size ID of the pizza (SMALL, MEDIUM, LARGE). Default to MEDIUM." }
        },
        required: ["name", "crustId", "sauceId", "cheeseId", "toppings", "size"]
      }
    }
  ]
};

const SYSTEM_INSTRUCTION = "You are Pie...";

async function test() {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [buildPizzaTool],
    });
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessage("build me a spicy non veg pizza");
    console.log(result.response.functionCalls());
    console.log(result.response.text());
  } catch (err) {
    console.error("ERROR:", err);
  }
}
test();
