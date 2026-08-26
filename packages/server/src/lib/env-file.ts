import fs from "node:fs";

export function applyEnvEdit(content: string, key: string, value: string | null): string {
  const line = value === null ? null : `${key}=${value}`;
  const lines = content.length === 0 ? [] : content.split("\n");
  const isTarget = (l: string) => new RegExp(`^\\s*${key}\\s*=`).test(l);

  if (!lines.some(isTarget)) {
    if (line === null) return content;
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return [...out, line, ""].join("\n");
  }

  let replaced = false;
  const out: string[] = [];
  for (const l of lines) {
    if (!isTarget(l)) {
      out.push(l);
      continue;
    }
    if (line !== null && !replaced) out.push(line);
    replaced = true;
  }
  return out.join("\n");
}

// This file holds API keys, and in the packaged app this call is what creates it — so 0600 rather
// than whatever the umask says, and written-then-renamed so a crash mid-write cannot leave a
// truncated file with DATABASE_URL missing.
export function updateEnvFile(filePath: string, key: string, value: string | null): void {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, applyEnvEdit(content, key, value), { mode: 0o600 });
  fs.renameSync(temp, filePath);
}
