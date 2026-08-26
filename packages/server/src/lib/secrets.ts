import { env, envFilePath } from "../env.ts";
import { updateEnvFile } from "./env-file.ts";

// Every key a user can paste in rather than having to edit a file. The desktop app has no
// checkout and no shell, so anything absent from this table is unreachable to the people it was
// built for — CARTESIA_API_KEY and ELEVENLABS_API_KEY were, for exactly that reason.
export const SECRETS = [
  { envVar: "DEEPSEEK_API_KEY", label: "DeepSeek", kind: "llm", provider: "deepseek" },
  { envVar: "OPENAI_API_KEY", label: "OpenAI", kind: "llm", provider: "openai" },
  { envVar: "ANTHROPIC_API_KEY", label: "Anthropic", kind: "llm", provider: "anthropic" },
  { envVar: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google Gemini", kind: "llm", provider: "google" },
  {
    envVar: "CARTESIA_API_KEY",
    label: "Cartesia",
    kind: "voice",
    hint: "Cloud voices in most languages, billed per character.",
  },
  {
    envVar: "ELEVENLABS_API_KEY",
    label: "ElevenLabs",
    kind: "voice",
    hint: "The free tier gives a key and 10,000 characters a month.",
  },
] as const satisfies readonly { envVar: keyof typeof env; label: string; kind: "llm" | "voice"; provider?: string; hint?: string }[];

export type SecretVar = (typeof SECRETS)[number]["envVar"];

export const SECRET_VARS = SECRETS.map((s) => s.envVar) as [SecretVar, ...SecretVar[]];

export function secretsOfKind(kind: "llm" | "voice") {
  return SECRETS.filter((s) => s.kind === kind);
}

export function isConfigured(envVar: SecretVar): boolean {
  return Boolean(env[envVar]);
}

// The last four characters, so a key can be recognised without being handed back to the client.
export function keyHint(envVar: SecretVar): string | null {
  const value = env[envVar];
  return value ? `…${value.slice(-4)}` : null;
}

export function setSecret(envVar: SecretVar, value: string | null): void {
  const cleaned = value?.trim() || null;
  if (cleaned && /[\r\n]/.test(cleaned)) throw new Error("API key must be a single line");
  updateEnvFile(envFilePath, envVar, cleaned);
  env[envVar] = cleaned ?? undefined;
}

export function secretStatus() {
  return {
    // Shown in settings: "where does my key go" has a different answer in a checkout and in the app
    path: envFilePath,
    keys: SECRETS.map((s) => ({
      envVar: s.envVar,
      label: s.label,
      kind: s.kind,
      hint: "hint" in s ? s.hint : null,
      configured: isConfigured(s.envVar),
      keyHint: keyHint(s.envVar),
    })),
  };
}
