import { provider } from "./instrumentation.js";
import OpenAI from "openai";

const client = new OpenAI();

const response = await client.chat.completions.create({
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  messages: [
    {
      role: "user",
      content: "Reply with exactly: Phoenix AWS trace working",
    },
  ],
  max_tokens: 20,
});

console.log(response.choices[0].message.content);

await provider.shutdown();
