type JsonSubsystemCaller = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface StructuredValidationError {
  [key: string]: unknown;
  code: string;
  message: string;
  recoverable: boolean;
  next_steps: string[];
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: StructuredValidationError };

export function isInheritedComponent(
  componentName: string,
  blueprintData: Record<string, unknown>,
): boolean {
  const components = Array.isArray(blueprintData.components)
    ? blueprintData.components
    : Array.isArray(blueprintData.Components)
      ? blueprintData.Components
      : [];

  for (const comp of components) {
    if (typeof comp !== 'object' || comp === null) continue;
    const c = comp as Record<string, unknown>;
    const name = c.name ?? c.Name ?? c.component_name ?? c.ComponentName;
    const inherited = c.inherited ?? c.bInherited ?? c.is_inherited;
    if (name === componentName && inherited === true) {
      return true;
    }
  }
  return false;
}

export async function validateInheritedComponents(
  assetPath: string,
  componentNames: string[],
  callSubsystemJson: JsonSubsystemCaller,
): Promise<ValidationResult> {
  if (componentNames.length === 0) {
    return { valid: true };
  }

  let blueprintData: Record<string, unknown>;
  try {
    blueprintData = await callSubsystemJson('ExtractBlueprint', {
      AssetPath: assetPath,
      Scope: 'Components',
      bIncludeClassDefaults: false,
    });
  } catch {
    // If extraction fails, allow the operation to proceed — the C++ side
    // will provide its own error. Don't block on a pre-validation failure.
    return { valid: true };
  }

  for (const componentName of componentNames) {
    if (isInheritedComponent(componentName, blueprintData)) {
      return {
        valid: false,
        error: {
          code: 'INHERITED_COMPONENT',
          message: `Component '${componentName}' in '${assetPath}' is inherited from a parent class and cannot be directly modified. Use the parent blueprint or UInheritableComponentHandler-compatible operations.`,
          recoverable: true,
          next_steps: [
            `Modify the component in the parent blueprint that owns '${componentName}'.`,
            'Use patch_component with override-aware parameters if the engine supports it.',
            'Extract the parent blueprint to identify the owning class.',
          ],
        },
      };
    }
  }

  return { valid: true };
}
