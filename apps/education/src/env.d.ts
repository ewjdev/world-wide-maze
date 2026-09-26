/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of Pip's pre-generated voice clips (defaults to DEFAULT_AUDIO_BASE from @wwm/learning). */
  readonly VITE_LEARNING_AUDIO_BASE?: string;
}
