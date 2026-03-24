export type ProjectAutomationContext = {
  success?: boolean;
  operation?: string;
  projectName?: string;
  projectFilePath?: string;
  projectDir?: string;
  engineDir?: string;
  engineRoot?: string;
  editorTarget?: string;
  hostPlatform?: string;
  supportsLiveCoding?: boolean;
  liveCodingAvailable?: boolean;
  liveCodingEnabled?: boolean;
  liveCodingStarted?: boolean;
  liveCodingError?: string;
};

export type ProjectInputSource = 'explicit' | 'editor_context' | 'environment' | 'missing';

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
