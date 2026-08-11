// One-off asset build script: downloads PixelLab animation frames and
// composites each idle/work animation into a single horizontal spritesheet
// PNG under public/guild/sprites/, plus a manifest of frame counts/sizes
// that GuildExperience.tsx reads to drive the CSS steps() animation.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import manifest from "./sprite-manifest.json" with { type: "json" };

const outDir = path.resolve("public/guild/sprites");
await mkdir(outDir, { recursive: true });

async function frameFiles(animationRoot, state) {
  const directory = path.resolve(animationRoot, state, "south");
  return (await readdir(directory))
    .filter((file) => /^frame_\d+\.png$/i.test(file))
    .sort()
    .map((file) => path.join(directory, file));
}

async function buildSheet(agentId, state, files) {
  const buffers = await Promise.all(files.map((file) => readFile(file)));
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const frameWidth = Math.max(...metas.map((m) => m.width));
  const frameHeight = Math.max(...metas.map((m) => m.height));
  const composites = buffers.map((buffer, i) => ({
    input: buffer,
    left: i * frameWidth,
    top: 0,
  }));
  const sheet = sharp({
    create: {
      width: frameWidth * buffers.length,
      height: frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites);
  const fileName = `${agentId}-${state}.png`;
  await sheet.png().toFile(path.join(outDir, fileName));
  return { file: `/guild/sprites/${fileName}`, frames: buffers.length, frameWidth, frameHeight };
}

const result = {};
for (const [agentId, animationRoot] of Object.entries(manifest)) {
  result[agentId] = {};
  for (const state of ["idle", "work"]) {
    const files = await frameFiles(animationRoot, state);
    console.log(`building ${agentId}/${state} (${files.length} frames)`);
    result[agentId][state] = await buildSheet(agentId, state, files);
  }
}

await writeFile(
  path.resolve("lib/guild-sprites.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log("done ->", path.resolve("lib/guild-sprites.json"));
