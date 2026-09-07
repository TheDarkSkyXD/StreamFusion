import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const configFile = ts.readConfigFile(path.join(root, "apps/desktop/tsconfig.json"), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.join(root, "apps/desktop"));
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const base = path.join(root, "apps/desktop/src/frontend/features/playback");
for (const [relative, targetName, functionName] of [
  ["components/player/hls-player.tsx", "hls-playback-session", "startHlsPlaybackSession"],
  ["components/player/twitch/twitch-hls-player.tsx", "twitch-hls-session", "startTwitchHlsSession"],
]) {
  const fileName = path.join(base, relative);
  const adapterFile = path.join(base, "adapters/browser", targetName + ".ts");
  if (fs.existsSync(adapterFile)) throw new Error(`Adapter already exists: ${adapterFile}`);
  const file = program.getSourceFile(fileName);
  let effect;
  const find = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect" && node.arguments[0]?.getText(file).includes("Hls.isSupported")) effect = node.arguments[0];
    ts.forEachChild(node, find);
  };
  find(file);
  if (!effect || !ts.isBlock(effect.body)) throw new Error("Expected HLS lifecycle effect");
  const component = file.statements.find((statement) => ts.isVariableStatement(statement) && statement.getText(file).includes("forwardRef<"));
  const dependencies = new Map();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (declaration && declaration.getSourceFile() === file && declaration.pos > component.pos && declaration.pos < effect.pos) {
        let type = checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation);
        type = type.replaceAll("React.RefObject<", "MutableCell<").replace("React.Dispatch<React.SetStateAction<number | null>>", "(delay: number | null) => void");
        dependencies.set(node.text, type);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(effect);
  const names = [...dependencies.keys()];
  const declarations = file.statements.filter((statement) => statement.pos < component.pos && !ts.isImportDeclaration(statement) && !statement.getText(file).startsWith("export interface HlsPlayerProps") && !statement.getText(file).startsWith("export interface TwitchHlsPlayerProps"));
  const imports = file.statements.filter((statement) => ts.isImportDeclaration(statement) && !["react", "react-i18next"].includes(statement.moduleSpecifier.text) && !statement.moduleSpecifier.text.includes("/hooks/") && !statement.getText(file).includes("useAuthStore") && !statement.getText(file).includes("useLivePlaybackStallRecovery"));
  const rebase = (text) => text.replace(/(["'])(\.\.?\/[^"']+)\1/g, (_match, quote, specifier) => {
    const target = path.resolve(path.dirname(fileName), specifier);
    let output = path.relative(path.dirname(adapterFile), target).split(path.sep).join("/");
    if (!output.startsWith(".")) output = "./" + output;
    return quote + output + quote;
  });
  const top = declarations.map((statement) => {
    const text = statement.getText(file);
    return text.startsWith("export ") ? text : "export " + text;
  }).join("\n\n");
  let body = effect.body.getText(file).slice(1, -1).replace(/^      /gm, "  ");
  body = body.replaceAll("useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES", "bufferPreferences");
  const adapter = [
    ...imports.map((statement) => rebase(statement.getText(file))),
    'import type { PlaybackRecoveryObserver } from "../../capabilities/playback-recovery";',
    'import type { BufferPreferences } from "@shared/auth-types";',
    'interface MutableCell<Value> { current: Value; }',
    rebase(top),
    `interface SessionBindings {\n${[...dependencies].map(([name, type]) => `  ${name}: ${rebase(type)};`).join("\n")}\n  bufferPreferences: BufferPreferences;\n}`,
    `export function ${functionName}({ ${names.join(", ")}, bufferPreferences }: SessionBindings): (() => void) | undefined {${body}\n}`,
  ].join("\n\n") + "\n";
  const exportedNames = declarations.flatMap((statement) => ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((declaration) => declaration.name.getText(file)) : statement.name ? [statement.name.text] : []);
  const adapterSpecifier = path.relative(path.dirname(fileName), adapterFile).split(path.sep).join("/").replace(/\.ts$/, "");
  const edits = declarations.map((statement) => ({ start: statement.getStart(file), end: statement.end, text: "" }));
  edits.push({ start: effect.getStart(file), end: effect.end, text: `() => ${functionName}({\n${names.map((name) => `      ${name},`).join("\n")}\n      bufferPreferences: useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES,\n    })` });
  let output = file.text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  output = `import { ${functionName}, ${exportedNames.join(", ")} } from "${adapterSpecifier}";\n` + output;
  fs.writeFileSync(adapterFile, adapter);
  fs.writeFileSync(fileName, output);
  console.log(`${relative}: extracted ${body.split("\n").length} lifecycle lines, ${names.length} explicit bindings`);
}
