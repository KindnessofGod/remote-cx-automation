import { provider } from "./instrumentation.js";

// Import AFTER instrumentation is registered.
const { classifyRequest } = await import("../../src/uc01/classifier.js");

const input = {
  text: "Please provide an employment verification letter for my bank and include my salary.",
  hasAttachment: false,
};

const result = await classifyRequest(input);

console.log("UC-01 classifier result:");
console.log(JSON.stringify(result, null, 2));

await provider.shutdown();
