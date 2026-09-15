import { readFileSync } from "node:fs";

const xml = readFileSync(process.argv[2], "utf8");
const nodes = [...xml.matchAll(/<node [^>]+>/g)].map((match) => {
  const attrs = Object.fromEntries(
    [...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]),
  );
  const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  return {
    text: attrs.text ?? "",
    desc: attrs["content-desc"] ?? "",
    res: attrs["resource-id"] ?? "",
    clickable: attrs.clickable === "true",
    top: bounds ? Number(bounds[2]) : 0,
    bottom: bounds ? Number(bounds[4]) : 0,
    left: bounds ? Number(bounds[1]) : 0,
    right: bounds ? Number(bounds[3]) : 0,
  };
});
for (const node of nodes) {
  const hay = `${node.res} ${node.desc} ${node.text}`.toLowerCase();
  if (
    hay.includes("nav") ||
    hay.includes("more") ||
    hay.includes("diagnostic") ||
    hay.includes("watch") ||
    hay.includes("activity")
  ) {
    console.log(JSON.stringify(node));
  }
}
