// Fonte unica de verdade da versao: package.json.
// Propaga o numero para os manifestos de cada plataforma, que antes divergiam
// (o empacotamento LG anunciava 0.7.1 enquanto o servidor dizia 0.6.5).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Versao invalida em package.json: ${version}`);
  process.exit(1);
}

// versionCode segue a convencao ja usada no projeto: 0.6.5 -> 65, 0.7.2 -> 72.
const [major, minor, patch] = version.split(".").map(Number);
const versionCode = major * 100 + minor * 10 + patch;

const edits = [
  ["platforms/webos/appinfo.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`],
  ["platforms/lg-webos/appinfo.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`],
  ["platforms/web/package.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`],
  ["platforms/web/platform.config.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`],
  ["platforms/tizen/config.xml", /(<widget[^>]*\sversion=)"[^"]*"/, `$1"${version}"`],
  ["platforms/android-native/app/build.gradle", /(versionName\s+)'[^']*'/, `$1'${version}'`],
  ["platforms/android-native/app/build.gradle", /(versionCode\s+)\d+/, `$1${versionCode}`],
  [
    "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/MainActivity.java",
    /(private static final String APP_VERSION = )"[^"]*"/,
    `$1"${version}"`
  ]
];

let changed = 0;
for (const [relative, pattern, replacement] of edits) {
  const file = path.join(root, relative);
  let source;
  try { source = readFileSync(file, "utf8"); }
  catch { console.warn(`ignorado (nao existe): ${relative}`); continue; }
  if (!pattern.test(source)) { console.warn(`ignorado (padrao nao encontrado): ${relative}`); continue; }
  const updated = source.replace(pattern, replacement);
  if (updated === source) { console.log(`ja em ${version}: ${relative}`); continue; }
  writeFileSync(file, updated);
  changed += 1;
  console.log(`atualizado para ${version}: ${relative}`);
}
console.log(`\n${changed} arquivo(s) alterado(s). Versao: ${version}`);
