export type EditorSelectionSource = 'workspace_auto' | 'manual' | 'launch' | 'none';

export type EditorInstanceSnapshot = {
  instanceId: string;
  projectName?: string;
  projectFilePath: string;
  projectDir?: string;
  engineRoot?: string;
  engineVersion?: string;
  editorTarget?: string;
  processId?: number;
  remoteControlHost: string;
  remoteControlPort: number;
  lastSeenAt?: string;
};

export type ActiveEditorState = {
  active: boolean;
  selectionSource: EditorSelectionSource;
  workspaceProjectPath?: string;
  autoBindAllowed: boolean;
  healthy: boolean;
  activeEditor?: EditorInstanceSnapshot;
  message?: string;
};

export type EditorRegistryListResult = {
  editors: EditorInstanceSnapshot[];
  registryDir: string;
  staleEntryCount: number;
};

