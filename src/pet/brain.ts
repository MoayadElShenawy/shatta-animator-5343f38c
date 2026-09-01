/**
 * Pet brain — the orchestration layer between the character UI and the AI
 * adapter.
 *
 * Character UI -> Pet Brain -> AI Adapter (askShatta) -> provider -> /api/chat
 *
 * The brain composes *what the AI is told*: who the character is, what is
 * happening right now (interaction context), the user's message, the relevant
 * slice of conversation history and which capabilities are currently allowed.
 * It stores nothing: no memory, no profiling, no persistence.
 */

import { askShatta } from "@/ai";
import type { AiMessage, AiResponse } from "@/ai/types";
import { describeCapabilities, type CapabilityGate } from "@/capabilities/registry";
import type { CapabilityDescriptor } from "@/capabilities/types";
import { getActiveCharacter } from "@/characters/registry";
import type { CharacterDefinition } from "@/characters/types";
import { getShattaContext, type ShattaContext } from "@/pet/context";

export type BrainFlags = CapabilityGate["flags"];

export const DEFAULT_BRAIN_FLAGS: BrainFlags = {
  webSearch: false,
  fileOperations: false,
  systemAccess: false,
  confirmSensitive: true,
};

export type BrainRequest = {
  message: string;
  /** Prior turns, WITHOUT the message being sent. */
  history?: readonly AiMessage[];
  flags?: Partial<BrainFlags>;
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  character?: CharacterDefinition;
  context?: ShattaContext | null;
};

export type ComposedTurn = {
  character: { id: string; name: string; persona: CharacterDefinition["persona"] };
  systemPrompt: string;
  message: string;
  history: readonly AiMessage[];
  context: ShattaContext;
  capabilities: readonly CapabilityDescriptor[];
};

/** Pure composition — used by the brain and easy to inspect/test. */
export function composeTurn(request: BrainRequest): ComposedTurn {
  const character = request.character ?? getActiveCharacter();
  const flags = { ...DEFAULT_BRAIN_FLAGS, ...request.flags };
  const turns = character.chat?.historyTurns ?? 20;
  const history = (request.history ?? []).slice(-turns);

  const gate: CapabilityGate = {
    allowed: character.capabilities?.allowedCapabilities ?? [],
    flags,
  };

  return {
    character: { id: character.id, name: character.name, persona: character.persona },
    systemPrompt: character.systemPrompt,
    message: request.message,
    history,
    context: request.context ?? getShattaContext(),
    capabilities: describeCapabilities(gate),
  };
}

/** Ask the active character. Always resolves with the adapter's response shape. */
export async function askPet(request: BrainRequest): Promise<AiResponse> {
  const turn = composeTurn(request);
  return askShatta({
    message: turn.message,
    history: turn.history,
    context: turn.context,
    character: turn.character,
    capabilities: turn.capabilities,
    ...(request.onChunk ? { onChunk: request.onChunk } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });
}
