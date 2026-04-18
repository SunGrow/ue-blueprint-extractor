export type ProjectAutomationContext = {
  success?: boolean;
  operation?: string;
  instanceId?: string;
  projectName?: string;
  projectFilePath?: string;
  projectDir?: string;
  engineDir?: string;
  engineRoot?: string;
  engineVersion?: string;
  editorTarget?: string;
  processId?: number;
  remoteControlHost?: string;
  remoteControlPort?: number;
  lastSeenAt?: string;
  isPlayingInEditor?: boolean;
  hostPlatform?: string;
  supportsLiveCoding?: boolean;
  liveCodingAvailable?: boolean;
  liveCodingEnabled?: boolean;
  liveCodingStarted?: boolean;
  liveCodingError?: string;
};

export type EditorContextPieSummary = {
  isPlayingInEditor?: boolean;
  isSimulatingInEditor?: boolean;
  worldName?: string;
  worldPath?: string;
};

export type EditorContextSnapshot = {
  success?: boolean;
  operation?: string;
  instanceId?: string;
  projectName?: string;
  projectFilePath?: string;
  projectDir?: string;
  engineRoot?: string;
  editorTarget?: string;
  remoteControlHost?: string;
  remoteControlPort?: number;
  lastSeenAt?: string;
  selectedAssetPaths?: string[];
  selectedActorNames?: string[];
  openAssetEditors?: string[];
  activeLevel?: string;
  pieSummary?: EditorContextPieSummary;
  partial?: boolean;
  unsupportedSections?: string[];
};

export type ProjectInputSource =
  | 'explicit'
  | 'editor_context'
  | 'workspace'
  | 'environment'
  | 'project_association'
  | 'filesystem_heuristic'
  | 'missing';

export type ResolvedProjectInputs = {
  engineRoot?: string;
  projectPath?: string;
  target?: string;
  context: ProjectAutomationContext | null;
  contextError?: string;
  projectEngineAssociation?: string;
  engineRootConflict?: string;
  sources: {
    engineRoot: ProjectInputSource;
    projectPath: ProjectInputSource;
    target: ProjectInputSource;
  };
};
