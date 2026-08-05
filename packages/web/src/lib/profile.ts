const KEY = "profile.id";

export function getStoredProfileId(): string | null {
  return localStorage.getItem(KEY);
}

export function setStoredProfileId(id: string | null) {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
}

// Missing header → server falls back to the default profile
export function profileHeaders(): Record<string, string> {
  const id = getStoredProfileId();
  return id ? { "x-profile-id": id } : {};
}
