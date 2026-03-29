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

export type ProjectInputSource = 'explicit' | 'editor_context' | 'workspace' | 'environment' | 'filesystem_heuristic' | 'missing';

export type ResolvedProjectInputs = {
  engineRoot?: string;
  projectPath?: string;
  target?: string;
  context: ProjectAutomationContext | null;
  contextError?: string;
  sources: {
    engineRoot: ProjectInputSource;
    projectPath: ProjectInputSource;
    target: ProjectInputSource;
  };
};
