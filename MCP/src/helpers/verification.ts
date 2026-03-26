import { buildCaptureResourceUri } from './capture.js';
import {
  firstDefinedString,
  isPlainObject,
} from './formatting.js';

type VerificationSurface =
  | 'editor_offscreen'
  | 'pie_runtime'
  | 'editor_tool_viewport'
  | 'external_packaged'
  | 'widget_motion_checkpoint';

function isVerificationSurface(value: unknown): value is VerificationSurface {
  return value === 'editor_offscreen'
    || value === 'pie_runtime'
    || value === 'editor_tool_viewport'
    || value === 'external_packaged'
    || value === 'widget_motion_checkpoint';
}

function inferVerificationSurface(captureType: unknown): VerificationSurface {
  if (isVerificationSurface(captureType)) {
    return captureType;
  }

  switch (captureType) {
    case 'widget_motion_checkpoint':
      return 'widget_motion_checkpoint';
    case 'widget_preview':
    case 'comparison_diff':
    default:
      return 'editor_offscreen';
  }
}

function unknownToStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function buildDefaultArtifactScenarioId(payload: Record<string, unknown>) {
  const captureType = typeof payload.captureType === 'string' && payload.captureType.length > 0
    ? payload.captureType
    : 'capture';
  const source = typeof payload.assetPath === 'string' && payload.assetPath.length > 0
    ? payload.assetPath
    : typeof payload.captureId === 'string' && payload.captureId.length > 0
      ? payload.captureId
      : 'capture';
  return `${captureType}:${source}`;
}

function buildDefaultWorldContext(payload: Record<string, unknown>, surface: VerificationSurface) {
  if (isPlainObject(payload.worldContext)) {
    return payload.worldContext;
  }

  if (surface === 'editor_offscreen') {
    const context: Record<string, unknown> = {
      contextType: 'widget_blueprint',
      renderLane: 'offscreen',
    };
    if (typeof payload.assetPath === 'string' && payload.assetPath.length > 0) {
      context.assetPath = payload.assetPath;
    }
    if (typeof payload.widgetClass === 'string' && payload.widgetClass.length > 0) {
      context.widgetClass = payload.widgetClass;
    }
    return context;
  }

  if (surface === 'widget_motion_checkpoint') {
    const context: Record<string, unknown> = {
      contextType: 'widget_motion',
      renderLane: 'offscreen_animation',
    };
    if (typeof payload.assetPath === 'string' && payload.assetPath.length > 0) {
      context.assetPath = payload.assetPath;
    }
    if (typeof payload.widgetClass === 'string' && payload.widgetClass.length > 0) {
      context.widgetClass = payload.widgetClass;
    }
    if (typeof payload.checkpointName === 'string' && payload.checkpointName.length > 0) {
      context.checkpointName = payload.checkpointName;
    }
    if (typeof payload.playbackSource === 'string' && payload.playbackSource.length > 0) {
      context.playbackSource = payload.playbackSource;
    }
    if (typeof payload.triggerMode === 'string' && payload.triggerMode.length > 0) {
      context.triggerMode = payload.triggerMode;
    }
    return context;
  }

  return undefined;
}

function buildDefaultCameraContext(payload: Record<string, unknown>, surface: VerificationSurface) {
  if (isPlainObject(payload.cameraContext)) {
    return payload.cameraContext;
  }

  const width = typeof payload.width === 'number' ? payload.width : undefined;
  const height = typeof payload.height === 'number' ? payload.height : undefined;
  if (surface === 'editor_offscreen' && (typeof width === 'number' || typeof height === 'number')) {
    return {
      contextType: 'offscreen_widget',
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
    };
  }

  if (surface === 'widget_motion_checkpoint') {
    return {
      contextType: 'motion_checkpoint',
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      ...(typeof payload.checkpointMs === 'number' ? { checkpointMs: payload.checkpointMs } : {}),
    };
  }

  return undefined;
}

function isImageMimeType(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('image/');
}

function inferAutomationArtifactCaptureType(name: string, relativePath?: string): string {
  const lower = `${name} ${relativePath ?? ''}`.toLowerCase();
  if (lower.includes('diff')) {
    return 'automation_diff';
  }
  if (lower.includes('screenshot') || lower.includes('capture')) {
    return 'automation_screenshot';
  }
  return 'automation_image_artifact';
}

function normalizeAutomationVerificationArtifacts(payload: Record<string, unknown>): Record<string, unknown>[] {
  const createdAt = firstDefinedString(payload.completedAt, payload.startedAt) ?? '';
  const runId = firstDefinedString(payload.runId) ?? 'automation';
  const automationFilter = firstDefinedString(payload.automationFilter) ?? runId;
  const target = firstDefinedString(payload.target);
  const projectDir = firstDefinedString(payload.projectDir);

  const existing = Array.isArray(payload.verificationArtifacts)
    ? payload.verificationArtifacts.filter(isPlainObject)
    : [];
  if (existing.length > 0) {
    return existing.map((artifact) => {
      const normalized = normalizeVerificationArtifact({
        ...artifact,
        surface: isVerificationSurface(artifact.surface) ? artifact.surface : 'pie_runtime',
        captureType: typeof artifact.captureType === 'string' && artifact.captureType.length > 0
          ? artifact.captureType
          : 'automation_image_artifact',
        createdAt: typeof artifact.createdAt === 'string' && artifact.createdAt.length > 0
          ? artifact.createdAt
          : createdAt,
      });

      return {
        ...normalized,
        resourceUri: typeof artifact.resourceUri === 'string' ? artifact.resourceUri : '',
        ...(typeof artifact.mimeType === 'string' ? { mimeType: artifact.mimeType } : {}),
        ...(typeof artifact.relativePath === 'string' ? { relativePath: artifact.relativePath } : {}),
      };
    });
  }

  const artifacts = Array.isArray(payload.artifacts)
    ? payload.artifacts.filter(isPlainObject)
    : [];

  return artifacts
    .filter((artifact) => isImageMimeType(artifact.mimeType) && typeof artifact.path === 'string')
    .map((artifact, index) => {
      const relativePath = typeof artifact.relativePath === 'string' ? artifact.relativePath : undefined;
      const name = typeof artifact.name === 'string' && artifact.name.length > 0
        ? artifact.name
        : `automation_artifact_${index}`;
      const normalized = normalizeVerificationArtifact({
        captureId: `${runId}:${name}`,
        captureType: inferAutomationArtifactCaptureType(name, relativePath),
        surface: 'pie_runtime',
        scenarioId: `automation:${automationFilter}:${name}`,
        assetPath: '',
        assetPaths: [],
        artifactPath: artifact.path,
        createdAt,
        worldContext: {
          contextType: 'automation_run',
          runId,
          automationFilter,
          ...(target ? { target } : {}),
          ...(projectDir ? { projectDir } : {}),
          ...(typeof payload.nullRhi === 'boolean' ? { nullRhi: payload.nullRhi } : {}),
          reportArtifactName: name,
          ...(relativePath ? { relativePath } : {}),
        },
        cameraContext: {
          contextType: 'automation_report_artifact',
          captureLane: 'automation',
          ...(relativePath ? { relativePath } : {}),
        },
        ...(projectDir ? { projectDir } : {}),
      });

      return {
        ...normalized,
        resourceUri: typeof artifact.resourceUri === 'string' ? artifact.resourceUri : '',
        mimeType: artifact.mimeType,
        ...(relativePath ? { relativePath } : {}),
      };
    });
}

export function normalizeVerificationArtifact(payload: unknown): Record<string, unknown> {
  const basePayload: Record<string, unknown> = isPlainObject(payload) ? { ...payload } : { data: payload };
  const assetPaths = unknownToStringArray(basePayload.assetPaths);
  const assetPath = typeof basePayload.assetPath === 'string'
    ? basePayload.assetPath
    : assetPaths[0] ?? '';
  const mergedAssetPaths = assetPaths.length > 0
    ? assetPaths
    : assetPath
      ? [assetPath]
      : [];
  const surface = isVerificationSurface(basePayload.surface)
    ? basePayload.surface
    : inferVerificationSurface(basePayload.captureType);
  const worldContext = buildDefaultWorldContext(basePayload, surface);
  const cameraContext = buildDefaultCameraContext(basePayload, surface);

  return {
    ...basePayload,
    assetPath,
    assetPaths: mergedAssetPaths,
    surface,
    scenarioId: typeof basePayload.scenarioId === 'string' && basePayload.scenarioId.length > 0
      ? basePayload.scenarioId
      : buildDefaultArtifactScenarioId({
        ...basePayload,
        assetPath,
      }),
    ...(worldContext ? { worldContext } : {}),
    ...(cameraContext ? { cameraContext } : {}),
  };
}

export function normalizeVerificationArtifactReference(payload: unknown): Record<string, unknown> {
  const artifact = normalizeVerificationArtifact(payload);
  const captureId = typeof artifact.captureId === 'string' ? artifact.captureId : '';
  return {
    ...artifact,
    resourceUri: captureId ? buildCaptureResourceUri(captureId) : '',
  };
}

export function normalizeVerificationComparison(payload: unknown): Record<string, unknown> {
  const basePayload: Record<string, unknown> = isPlainObject(payload) ? payload : {};
  const nested = isPlainObject(basePayload.comparison) ? basePayload.comparison : {};
  const result: Record<string, unknown> = {};

  const assignString = (targetKey: string, sourceKeys: string[]) => {
    const value = sourceKeys.find((key) => typeof nested[key] === 'string' && nested[key].length > 0)
      ? nested[sourceKeys.find((key) => typeof nested[key] === 'string' && nested[key].length > 0)!]
      : sourceKeys.find((key) => typeof basePayload[key] === 'string' && basePayload[key].length > 0)
        ? basePayload[sourceKeys.find((key) => typeof basePayload[key] === 'string' && basePayload[key].length > 0)!]
        : undefined;
    if (typeof value === 'string' && value.length > 0) {
      result[targetKey] = value;
    }
  };

  const assignNumber = (targetKey: string, sourceKeys: string[]) => {
    const value = sourceKeys.find((key) => typeof nested[key] === 'number' && Number.isFinite(nested[key]))
      ? nested[sourceKeys.find((key) => typeof nested[key] === 'number' && Number.isFinite(nested[key]))!]
      : sourceKeys.find((key) => typeof basePayload[key] === 'number' && Number.isFinite(basePayload[key]))
        ? basePayload[sourceKeys.find((key) => typeof basePayload[key] === 'number' && Number.isFinite(basePayload[key]))!]
        : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[targetKey] = value;
    }
  };

  const assignBoolean = (targetKey: string, sourceKeys: string[]) => {
    const value = sourceKeys.find((key) => typeof nested[key] === 'boolean')
      ? nested[sourceKeys.find((key) => typeof nested[key] === 'boolean')!]
      : sourceKeys.find((key) => typeof basePayload[key] === 'boolean')
        ? basePayload[sourceKeys.find((key) => typeof basePayload[key] === 'boolean')!]
        : undefined;
    if (typeof value === 'boolean') {
      result[targetKey] = value;
    }
  };

  assignString('capturePath', ['capturePath', 'capture']);
  assignString('referencePath', ['referencePath', 'reference']);
  assignString('diffCaptureId', ['diffCaptureId']);
  assignString('diffArtifactPath', ['diffArtifactPath']);
  assignNumber('tolerance', ['tolerance']);
  assignBoolean('pass', ['pass']);
  assignNumber('rmse', ['rmse', 'normalizedRmse']);
  assignNumber('maxPixelDelta', ['maxPixelDelta']);
  assignNumber('mismatchPixelCount', ['mismatchPixelCount', 'mismatchPixels']);
  assignNumber('mismatchPercentage', ['mismatchPercentage']);

  if (
    typeof result.mismatchPercentage !== 'number'
    && typeof result.mismatchPixelCount === 'number'
    && typeof nested.pixelCount === 'number'
    && Number.isFinite(nested.pixelCount)
    && nested.pixelCount > 0
  ) {
    result.mismatchPercentage = (result.mismatchPixelCount / nested.pixelCount) * 100;
  }

  return result;
}

export function normalizeAutomationRunResult(payload: unknown): Record<string, unknown> {
  const basePayload: Record<string, unknown> = isPlainObject(payload) ? { ...payload } : { data: payload };
  return {
    ...basePayload,
    verificationArtifacts: normalizeAutomationVerificationArtifacts(basePayload),
  };
}
