export type Voice = {
  id: string;
  label: string;
  gender: "F" | "M";
  grade: string;
};

export type VoiceGroup = {
  label: string;
  voices: Voice[];
};

export const voiceGroups: VoiceGroup[] = [
  {
    label: "American English",
    voices: [
      { id: "af_heart", label: "Heart", gender: "F", grade: "A" },
      { id: "af_bella", label: "Bella", gender: "F", grade: "A-" },
      { id: "af_nicole", label: "Nicole", gender: "F", grade: "B-" },
      { id: "af_aoede", label: "Aoede", gender: "F", grade: "C+" },
      { id: "af_kore", label: "Kore", gender: "F", grade: "C+" },
      { id: "af_sarah", label: "Sarah", gender: "F", grade: "C+" },
      { id: "af_alloy", label: "Alloy", gender: "F", grade: "C" },
      { id: "af_nova", label: "Nova", gender: "F", grade: "C" },
      { id: "af_sky", label: "Sky", gender: "F", grade: "C-" },
      { id: "af_jessica", label: "Jessica", gender: "F", grade: "D" },
      { id: "af_river", label: "River", gender: "F", grade: "D" },
      { id: "am_fenrir", label: "Fenrir", gender: "M", grade: "C+" },
      { id: "am_michael", label: "Michael", gender: "M", grade: "C+" },
      { id: "am_puck", label: "Puck", gender: "M", grade: "C+" },
      { id: "am_echo", label: "Echo", gender: "M", grade: "D" },
      { id: "am_eric", label: "Eric", gender: "M", grade: "D" },
      { id: "am_liam", label: "Liam", gender: "M", grade: "D" },
      { id: "am_onyx", label: "Onyx", gender: "M", grade: "D" },
      { id: "am_adam", label: "Adam", gender: "M", grade: "F+" },
    ],
  },
  {
    label: "British English",
    voices: [
      { id: "bf_emma", label: "Emma", gender: "F", grade: "B-" },
      { id: "bf_isabella", label: "Isabella", gender: "F", grade: "C" },
      { id: "bf_alice", label: "Alice", gender: "F", grade: "D" },
      { id: "bf_lily", label: "Lily", gender: "F", grade: "D" },
      { id: "bm_george", label: "George", gender: "M", grade: "C" },
      { id: "bm_fable", label: "Fable", gender: "M", grade: "C" },
      { id: "bm_lewis", label: "Lewis", gender: "M", grade: "D+" },
      { id: "bm_daniel", label: "Daniel", gender: "M", grade: "D" },
    ],
  },
  {
    label: "French",
    voices: [{ id: "ff_siwis", label: "Siwis", gender: "F", grade: "B-" }],
  },
  {
    label: "Spanish",
    voices: [
      { id: "ef_dora", label: "Dora", gender: "F", grade: "C" },
      { id: "em_alex", label: "Alex", gender: "M", grade: "C" },
    ],
  },
  {
    label: "Japanese",
    voices: [
      { id: "jf_alpha", label: "Alpha", gender: "F", grade: "C+" },
      { id: "jf_gongitsune", label: "Gongitsune", gender: "F", grade: "C" },
      { id: "jf_tebukuro", label: "Tebukuro", gender: "F", grade: "C" },
      { id: "jf_nezumi", label: "Nezumi", gender: "F", grade: "C-" },
      { id: "jm_kumo", label: "Kumo", gender: "M", grade: "C-" },
    ],
  },
  {
    label: "Mandarin Chinese",
    voices: [
      { id: "zf_xiaobei", label: "Xiaobei", gender: "F", grade: "D" },
      { id: "zf_xiaoni", label: "Xiaoni", gender: "F", grade: "D" },
      { id: "zf_xiaoxiao", label: "Xiaoxiao", gender: "F", grade: "D" },
      { id: "zf_xiaoyi", label: "Xiaoyi", gender: "F", grade: "D" },
      { id: "zm_yunjian", label: "Yunjian", gender: "M", grade: "D" },
      { id: "zm_yunxi", label: "Yunxi", gender: "M", grade: "D" },
      { id: "zm_yunxia", label: "Yunxia", gender: "M", grade: "D" },
      { id: "zm_yunyang", label: "Yunyang", gender: "M", grade: "D" },
    ],
  },
];
