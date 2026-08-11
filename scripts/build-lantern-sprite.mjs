import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const frameDirectory = path.join(
  projectRoot,
  "assets",
  "pixellab",
  "lantern-idle",
);
const outputPath = path.join(
  projectRoot,
  "public",
  "guild",
  "sprites",
  "lantern-idle.png",
);

const frameNames = (await readdir(frameDirectory))
  .filter((name) => /^frame_\d{2}\.png$/i.test(name))
  .sort();

if (frameNames.length === 0) {
  throw new Error(`No lantern animation frames found in ${frameDirectory}`);
}

const frameSize = 64;
const frames = await Promise.all(
  frameNames.map(async (name, index) => {
    const input = path.join(frameDirectory, name);
    const metadata = await sharp(input).metadata();

    if (metadata.width !== frameSize || metadata.height !== frameSize) {
      throw new Error(`${name} must be ${frameSize}x${frameSize}px`);
    }

    return { input, left: index * frameSize, top: 0 };
  }),
);

await mkdir(path.dirname(outputPath), { recursive: true });
await sharp({
  create: {
    width: frameSize * frames.length,
    height: frameSize,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(frames)
  .png({ palette: true })
  .toFile(outputPath);

console.log(
  `Built ${path.relative(projectRoot, outputPath)} from ${frames.length} frames.`,
);
