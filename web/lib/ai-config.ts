// One place that decides which AI provider the web app uses (mirrors worker/src/config.ts).
// AI_API_KEY takes priority; with a key but no AI_BASE_URL we default to Google Gemini's
// OpenAI-compatible endpoint (free tier, handles Amharic). OPENAI_API_KEY alone = classic OpenAI.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";
export function aiConfig() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const usingAiKey = !!process.env.AI_API_KEY;
  const baseURL = process.env.AI_BASE_URL || (usingAiKey ? GEMINI_BASE : undefined);
  const model = process.env.AI_MODEL || (usingAiKey && !process.env.AI_BASE_URL ? "gemini-3.8-flash" : undefined);
  return { apiKey, baseURL, model, jsonMode: !baseURL };
}
