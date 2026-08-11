import raw from "./guild-sprites.json";
import type { AgentId } from "./guild-data";

export type SpriteSheet = { file: string; frames: number; frameWidth: number; frameHeight: number };
export type AgentSpriteSet = { idle: SpriteSheet; work: SpriteSheet };

export const AGENT_SPRITES = raw as Record<AgentId, AgentSpriteSet>;
