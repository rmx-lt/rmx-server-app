// Asset imports handled by Bun's bundler.

// File System Access API — not yet in the TypeScript DOM lib
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
}

interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}

declare module "*.png" {
  /**
   * A path to the PNG file
   */
  const path: `${string}.png`;
  export = path;
}

declare module "*.css" {}
