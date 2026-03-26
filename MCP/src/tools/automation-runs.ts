import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AutomationControllerLike } from '../automation-controller.js';
import { buildResourceLinkContent, maybeBuildInlineImageContent } from '../helpers/capture.js';
import { explainProjectResolutionFailure } from '../helpers/project-utils.js';
import { jsonToolError, jsonToolSuccess } from '../helpers/subsystem.js';
import { normalizeAutomationRunResult } from '../helpers/verification.js';
import type { ResolvedProjectInputs } from '../tool-context.js';

type ResolveProjectInputs = (
  request: {
    engine_root?: string;
    project_path?: string;
    target?: string;
  },
) => Promise<ResolvedProjectInputs>;

type RegisterAutomationRunToolsOptions = {
  server: Pick<McpServer, 'registerTool'>;
  automationController: AutomationControllerLike;
  resolveProjectInputs: ResolveProjectInputs;
  automationRunSchema: z.ZodTypeAny;
  automationRunListSchema: z.ZodTypeAny;
};

function buildAutomationExtraContent(normalized: Record<string, unknown>): Promise<ContentBlock[]> {
  const extraContent: ContentBlock[] = ((Array.isArray(normalized.artifacts) ? normalized.artifacts : []) as Record<string, unknown>[])
    .slice(0, 6)
    .map((artifact) => buildResourceLinkContent(
      String(artifact.resourceUri ?? ''),
      `Automation ${String(artifact.name ?? 'artifact')}`,
      String(artifact.mimeType ?? 'application/octet-stream'),
      typeof artifact.relativePath === 'string' ? artifact.relativePath : String(artifact.path ?? ''),
    ));

  const verificationArtifacts = ((Array.isArray(normalized.verificationArtifacts) ? normalized.verificationArtifacts : []) as Record<string, unknown>[]).slice(0, 2);
  return (async () => {
    for (const artifact of verificationArtifacts) {
      const inlineImage = await maybeBuildInlineImageContent(
        typeof artifact.artifactPath === 'string' ? artifact.artifactPath : undefined,
      );
      if (inlineImage) {
        extraContent.push(inlineImage);
      }
    }
    return extraContent;
  })();
}

export function registerAutomationRunTools({
  server,
  automationController,
  resolveProjectInputs,
  automationRunSchema,
  automationRunListSchema,
}: RegisterAutomationRunToolsOptions): void {
  server.registerTool(
    'run_automation_tests',
    {
      title: 'Run Automation Tests',
      description: 'Run Automation Specs or Functional Tests in a headless editor process from the MCP host and return an async run id plus exported report artifacts.',
      inputSchema: {
        automation_filter: z.string().regex(
          /^[A-Za-z0-9_.+* -]+$/u,
          'automation_filter must contain only alphanumeric, dots, underscores, plus, asterisk, hyphen, and spaces',
        ).describe(
          'Automation test filter passed to `Automation RunTests <filter>`.',
        ),
        engine_root: z.string().optional().describe(
          'Optional Unreal Engine root. Falls back to editor context or UE_ENGINE_ROOT.',
        ),
        project_path: z.string().optional().describe(
          'Optional .uproject path. Falls back to editor context or UE_PROJECT_PATH.',
        ),
        target: z.string().optional().describe(
          'Optional editor target name to keep in the run metadata.',
        ),
        report_output_dir: z.string().optional().describe(
          'Optional host filesystem directory for this run.',
        ),
        timeout_seconds: z.number().int().positive().default(3600).describe(
          'Maximum wall-clock time for the automation process before the host terminates it.',
        ),
        null_rhi: z.boolean().default(true).describe(
          'When true, include -NullRHI for headless logic-focused automation runs.',
        ),
      },
      outputSchema: automationRunSchema,
      annotations: {
        title: 'Run Automation Tests',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ automation_filter, engine_root, project_path, target, report_output_dir, timeout_seconds, null_rhi }) => {
      try {
        const resolved = await resolveProjectInputs({ engine_root, project_path, target });
        if (!resolved.engineRoot || !resolved.projectPath) {
          throw explainProjectResolutionFailure(
            'run_automation_tests requires engine_root and project_path',
            resolved,
          );
        }

        const parsed = await automationController.runAutomationTests({
          automationFilter: automation_filter,
          engineRoot: resolved.engineRoot,
          projectPath: resolved.projectPath,
          target: resolved.target,
          reportOutputDir: report_output_dir,
          timeoutMs: timeout_seconds * 1000,
          nullRhi: null_rhi,
        });
        const normalized = normalizeAutomationRunResult(parsed);
        const extraContent = await buildAutomationExtraContent(normalized);

        return jsonToolSuccess({
          ...normalized,
          inputResolution: {
            engineRoot: resolved.sources.engineRoot,
            projectPath: resolved.sources.projectPath,
            target: resolved.sources.target,
            contextError: resolved.contextError,
          },
        }, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'get_automation_test_run',
    {
      title: 'Get Automation Test Run',
      description: 'Read the latest known status and exported artifacts for one host-side automation run.',
      inputSchema: {
        run_id: z.string().describe(
          'Run id returned by run_automation_tests.',
        ),
      },
      outputSchema: automationRunSchema,
      annotations: {
        title: 'Get Automation Test Run',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id }) => {
      try {
        const parsed = await automationController.getAutomationTestRun(run_id);
        if (!parsed) {
          return jsonToolError(new Error(`Automation test run '${run_id}' was not found.`));
        }
        const normalized = normalizeAutomationRunResult(parsed);
        const extraContent = await buildAutomationExtraContent(normalized);
        return jsonToolSuccess(normalized, { extraContent });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );

  server.registerTool(
    'list_automation_test_runs',
    {
      title: 'List Automation Test Runs',
      description: 'List host-side automation runs and their current statuses.',
      inputSchema: {
        include_completed: z.boolean().default(true).describe(
          'When true, include terminal runs in addition to still-running jobs.',
        ),
      },
      outputSchema: automationRunListSchema,
      annotations: {
        title: 'List Automation Test Runs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ include_completed }) => {
      try {
        const parsed = await automationController.listAutomationTestRuns(include_completed);
        return jsonToolSuccess({
          ...parsed,
          runs: Array.isArray(parsed.runs)
            ? parsed.runs.map((run) => normalizeAutomationRunResult(run))
            : [],
        });
      } catch (error) {
        return jsonToolError(error);
      }
    },
  );
}
