import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const binary = fileURLToPath(new URL("node_modules/.bin/oxlint", import.meta.url));
const config = fileURLToPath(new URL("anti-slop.json", import.meta.url));
const repository = fileURLToPath(new URL("../..", import.meta.url));
const shellQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export default {
  "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": (files) => {
    const checked = files.filter(
      (file) => !relative(repository, file).startsWith("tools/oxlint/anti-slop/"),
    );
    return checked.length === 0
      ? []
      : `${shellQuote(binary)} --disable-nested-config --config ${shellQuote(config)} ${checked.map(shellQuote).join(" ")}`;
  },
};
