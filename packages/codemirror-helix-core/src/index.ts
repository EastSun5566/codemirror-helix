export { createHelixEngine } from "./engine.js";
export {
  clamp,
  lineBounds,
  nextGraphemeBreak,
  offsetAtLine,
  previousGraphemeBreak,
  rangeFrom,
  rangeTo,
  wordBackward,
  wordEnd,
  wordForward,
} from "./text.js";
export type {
  HelixChange,
  HelixCommandContext,
  HelixCommandDefinition,
  HelixConfig,
  HelixEditorAdapter,
  HelixEngine,
  HelixEngineOptions,
  HelixExternalCommand,
  HelixMode,
  HelixPromptRequest,
  HelixScrollCommand,
  HelixSelection,
  HelixSnapshot,
  HelixStatusEvent,
} from "./types.js";
