export function parseEnv(text) {
  const values = Object.create(null);
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");
    const index = line.indexOf("=");
    if (index < 1) throw new Error("DESKTOP_ENV_INVALID");
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("DESKTOP_ENV_INVALID");
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else if (/^["']|["']$/.test(value)) {
      throw new Error("DESKTOP_ENV_INVALID");
    } else {
      value = value.replace(/\s#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}
