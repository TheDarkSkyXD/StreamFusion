import ts from "typescript";
import path from "node:path";
const root = process.cwd();
const configFile = ts.readConfigFile(path.join(root, "apps/desktop/tsconfig.json"), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.join(root, "apps/desktop"));
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
for (const relative of ["components/player/hls-player.tsx", "components/player/twitch/twitch-hls-player.tsx"]) {
  const file = program.getSourceFile(path.join(root, "apps/desktop/src/frontend/features/playback", relative));
  let target;
  const find = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect" && node.arguments[0]?.getText(file).includes("Hls.isSupported")) target = node.arguments[0];
    ts.forEachChild(node, find);
  };
  find(file);
  const dependencies = new Map();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (declaration && declaration.getSourceFile() === file && (declaration.pos < target.pos || declaration.end > target.end)) {
        dependencies.set(node.text, { type: checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation), line: file.getLineAndCharacterOfPosition(declaration.getStart(file)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(target);
  console.log(relative, JSON.stringify(Object.fromEntries(dependencies), null, 2));
}
