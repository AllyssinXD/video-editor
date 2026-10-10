/// <reference types="vite/client" />
import type { ImportedFile, LoadedProject, ProjectPayload } from "./types";

declare global {
  interface Window {
    api: {
      importMedia: () => Promise<ImportedFile[]>;
      loadProject: () => Promise<LoadedProject | null>;
      saveProject: (data: ProjectPayload) => Promise<boolean>;
      saveExport: (name: string, data: Uint8Array) => Promise<string | null>;
    };
  }
}

export {};
