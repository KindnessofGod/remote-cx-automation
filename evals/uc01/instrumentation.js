import "dotenv/config";
import OpenAI from "openai";
import {
  register,
  registerInstrumentations,
} from "@arizeai/phoenix-otel";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";

export const provider = register({
  projectName: process.env.PHOENIX_PROJECT_NAME,
  url: process.env.PHOENIX_COLLECTOR_ENDPOINT,
  apiKey: process.env.PHOENIX_API_KEY,
});

const openAIInstrumentation = new OpenAIInstrumentation();

openAIInstrumentation.manuallyInstrument(OpenAI);

registerInstrumentations({
  instrumentations: [openAIInstrumentation],
});
