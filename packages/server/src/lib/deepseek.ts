import { env } from "../env.ts";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 120_000;

export type DeepseekChatOptions = {
  temperature?: number;
  responseFormat?: "json_object";
  maxTokens?: number;
  timeoutMs?: number;
};

export async function deepseekChat(system: string, user: string, opts: DeepseekChatOptions = {}): Promise<string> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set — add it to .env");

  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  let data: { choices: { message: { content: string } }[] };
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts.temperature ?? 1.0,
        ...(opts.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        stream: false,
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DeepSeek API error ${res.status}: ${body.slice(0, 300)}`);
    }
    data = (await res.json()) as { choices: { message: { content: string } }[] };
  } catch (err) {
    if (signal.aborted) throw new Error(`DeepSeek request timed out after ${timeoutMs / 1000}s`);
    throw err;
  }
  const content = data.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek returned an empty response");
  return content;
}

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  for (let cause = err.cause; cause instanceof Error; cause = cause.cause) {
    parts.push(cause.message);
  }
  return parts.join(" — ");
}
