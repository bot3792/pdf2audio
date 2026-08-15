export type Voice = {
  id: string;
  label: string;
  gender: "F" | "M" | null;
  grade: string;
  supportsSpeed?: boolean;
  note?: string;
};

export type VoiceGroup = {
  label: string;
  voices: Voice[];
};

export const kokoroVoiceGroups: VoiceGroup[] = [
  {
    label: "American English",
    voices: [
      { id: "kokoro:af_heart", label: "Heart", gender: "F", grade: "A", supportsSpeed: true },
      { id: "kokoro:af_bella", label: "Bella", gender: "F", grade: "A-", supportsSpeed: true },
      { id: "kokoro:af_nicole", label: "Nicole", gender: "F", grade: "B-", supportsSpeed: true },
      { id: "kokoro:af_aoede", label: "Aoede", gender: "F", grade: "C+", supportsSpeed: true },
      { id: "kokoro:af_kore", label: "Kore", gender: "F", grade: "C+", supportsSpeed: true },
      { id: "kokoro:af_sarah", label: "Sarah", gender: "F", grade: "C+", supportsSpeed: true },
      { id: "kokoro:af_alloy", label: "Alloy", gender: "F", grade: "C", supportsSpeed: true },
      { id: "kokoro:af_nova", label: "Nova", gender: "F", grade: "C", supportsSpeed: true },
      { id: "kokoro:af_sky", label: "Sky", gender: "F", grade: "C-", supportsSpeed: true },
      { id: "kokoro:af_jessica", label: "Jessica", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:af_river", label: "River", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:am_fenrir", label: "Fenrir", gender: "M", grade: "C+", supportsSpeed: true },
      { id: "kokoro:am_michael", label: "Michael", gender: "M", grade: "C+", supportsSpeed: true },
      { id: "kokoro:am_puck", label: "Puck", gender: "M", grade: "C+", supportsSpeed: true },
      { id: "kokoro:am_echo", label: "Echo", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:am_eric", label: "Eric", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:am_liam", label: "Liam", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:am_onyx", label: "Onyx", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:am_adam", label: "Adam", gender: "M", grade: "F+", supportsSpeed: true },
    ],
  },
  {
    label: "British English",
    voices: [
      { id: "kokoro:bf_emma", label: "Emma", gender: "F", grade: "B-", supportsSpeed: true },
      { id: "kokoro:bf_isabella", label: "Isabella", gender: "F", grade: "C", supportsSpeed: true },
      { id: "kokoro:bf_alice", label: "Alice", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:bf_lily", label: "Lily", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:bm_george", label: "George", gender: "M", grade: "C", supportsSpeed: true },
      { id: "kokoro:bm_fable", label: "Fable", gender: "M", grade: "C", supportsSpeed: true },
      { id: "kokoro:bm_lewis", label: "Lewis", gender: "M", grade: "D+", supportsSpeed: true },
      { id: "kokoro:bm_daniel", label: "Daniel", gender: "M", grade: "D", supportsSpeed: true },
    ],
  },
  {
    label: "French",
    voices: [{ id: "kokoro:ff_siwis", label: "Siwis", gender: "F", grade: "B-", supportsSpeed: true }],
  },
  {
    label: "Spanish",
    voices: [
      { id: "kokoro:ef_dora", label: "Dora", gender: "F", grade: "C", supportsSpeed: true },
      { id: "kokoro:em_alex", label: "Alex", gender: "M", grade: "C", supportsSpeed: true },
    ],
  },
  {
    label: "Japanese",
    voices: [
      { id: "kokoro:jf_alpha", label: "Alpha", gender: "F", grade: "C+", supportsSpeed: true },
      { id: "kokoro:jf_gongitsune", label: "Gongitsune", gender: "F", grade: "C", supportsSpeed: true },
      { id: "kokoro:jf_tebukuro", label: "Tebukuro", gender: "F", grade: "C", supportsSpeed: true },
      { id: "kokoro:jf_nezumi", label: "Nezumi", gender: "F", grade: "C-", supportsSpeed: true },
      { id: "kokoro:jm_kumo", label: "Kumo", gender: "M", grade: "C-", supportsSpeed: true },
    ],
  },
  {
    label: "Mandarin Chinese",
    voices: [
      { id: "kokoro:zf_xiaobei", label: "Xiaobei", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:zf_xiaoni", label: "Xiaoni", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:zf_xiaoxiao", label: "Xiaoxiao", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:zf_xiaoyi", label: "Xiaoyi", gender: "F", grade: "D", supportsSpeed: true },
      { id: "kokoro:zm_yunjian", label: "Yunjian", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:zm_yunxi", label: "Yunxi", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:zm_yunxia", label: "Yunxia", gender: "M", grade: "D", supportsSpeed: true },
      { id: "kokoro:zm_yunyang", label: "Yunyang", gender: "M", grade: "D", supportsSpeed: true },
    ],
  },
];

export const narratorVoices: Voice[] = [
  { id: "bg-mlx:narrator", label: "BG-TTS V5 (Radi Totev MLX port)", gender: null, grade: "MLX", supportsSpeed: false, note: "Apple Silicon narrator" },
  { id: "bg-mms:bul", label: "MMS Bulgarian (Meta)", gender: null, grade: "VITS", supportsSpeed: false, note: "Meta MMS" },
  { id: "kugel:default", label: "KugelAudio (7B, 24 EU languages)", gender: null, grade: "MLX", supportsSpeed: false, note: "Multilingual narrator" },
];

export const voiceGroups: VoiceGroup[] = [
  ...kokoroVoiceGroups,
  { label: "Bulgarian", voices: narratorVoices },
];

const voicesById = new Map(voiceGroups.flatMap((group) => group.voices).map((voice) => [voice.id, voice]));

export function normalizeVoiceId(voiceId: string): string {
  return voiceId.includes(":") ? voiceId : `kokoro:${voiceId}`;
}

export function getVoiceById(voiceId: string): Voice | null {
  return voicesById.get(voiceId) ?? voicesById.get(normalizeVoiceId(voiceId)) ?? null;
}

export function getVoiceLabel(voiceId: string): string {
  const voice = getVoiceById(voiceId);
  if (!voice) {
    if (voiceId.startsWith("say:")) return humanizeSayVoiceId(voiceId);
    if (voiceId.startsWith("cartesia:")) return `Cartesia ${voiceId.slice("cartesia:".length, "cartesia:".length + 8)}`;
    return voiceId;
  }
  return voice.gender ? `${voice.label} (${voice.gender})` : voice.label;
}

// System voices are discovered at runtime, so stored ids may have no static entry
function humanizeSayVoiceId(voiceId: string): string {
  const words = voiceId.slice("say:".length).split("-").filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") + " (macOS)";
}

export function sayVoiceToEntry(voice: { slug: string; name: string; locale: string }): Voice {
  return {
    id: `say:${voice.slug}`,
    label: voice.name,
    gender: null,
    grade: "OS",
    supportsSpeed: true,
    note: voice.locale,
  };
}

export function cartesiaVoiceToEntry(voice: { id: string; name: string; language: string; gender: string | null; tagline: string }): Voice {
  return {
    id: `cartesia:${voice.id}`,
    label: voice.name,
    gender: voice.gender === "masculine" ? "M" : voice.gender === "feminine" ? "F" : null,
    grade: "API",
    supportsSpeed: true,
    note: voice.tagline || voice.language,
  };
}

export function voiceSupportsSpeedControl(voiceId: string): boolean {
  return getVoiceById(voiceId)?.supportsSpeed ?? !voiceId.startsWith("bg-");
}
