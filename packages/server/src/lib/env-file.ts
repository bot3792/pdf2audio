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

export function updateEnvFile(filePath: string, key: string, value: string | null): void {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  fs.writeFileSync(filePath, applyEnvEdit(content, key, value));
}
