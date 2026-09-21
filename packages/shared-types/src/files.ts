export type FileGroupId = "deployed" | "sample" | "demo";

export interface FileEntry {
  path: string;
  sizeBytes: number;
}

export interface FileGroup {
  id: FileGroupId;
  label: string;
  description: string;
  files: FileEntry[];
}

export interface FileContent {
  group: FileGroupId;
  path: string;
  content: string;
  lineCount: number;
}
