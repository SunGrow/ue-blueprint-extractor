import { describe, expect, it } from 'vitest';
import {
  DataTableRowSchema,
  CurveTypeSchema,
  CurveTableModeSchema,
  CurveKeyDeleteSchema,
  CurveKeyUpsertSchema,
  CurveChannelSchema,
  RichCurveKeySchema,
  JsonObjectSchema,
  BuildPlatformSchema,
  BuildConfigurationSchema,
  EnhancedInputValueTypeSchema,
  InputMappingSchema,
  ExtractAssetTypeSchema,
  MaterialScalarParameterSchema,
  MaterialVectorParameterSchema,
  MaterialTextureParameterSchema,
  MaterialStaticSwitchParameterSchema,
  WidgetNodeSchema,
  UserDefinedStructMutationOperationSchema,
  UserDefinedEnumMutationOperationSchema,
  BlackboardMutationOperationSchema,
  BehaviorTreeMutationOperationSchema,
  StateTreeMutationOperationSchema,
  AnimSequenceMutationOperationSchema,
  BlendSpaceMutationOperationSchema,
} from '../src/schemas/tool-inputs.js';

describe('Schema validation — tool-inputs', () => {
  describe('DataTableRowSchema', () => {
    it('accepts valid row with rowName and values', () => {
      const result = DataTableRowSchema.safeParse({ rowName: 'Row1', values: { HP: 100 } });
      expect(result.success).toBe(true);
    });

    it('rejects row without rowName', () => {
      const result = DataTableRowSchema.safeParse({ values: { HP: 100 } });
      expect(result.success).toBe(false);
    });
  });

  describe('CurveTypeSchema', () => {
    it('accepts Float', () => {
      expect(CurveTypeSchema.safeParse('Float').success).toBe(true);
    });

    it('rejects invalid curve type', () => {
      expect(CurveTypeSchema.safeParse('Quaternion').success).toBe(false);
    });
  });

  describe('CurveTableModeSchema', () => {
    it('accepts RichCurves', () => {
      expect(CurveTableModeSchema.safeParse('RichCurves').success).toBe(true);
    });

    it('rejects invalid mode', () => {
      expect(CurveTableModeSchema.safeParse('SparseKeys').success).toBe(false);
    });
  });

  describe('CurveKeyDeleteSchema', () => {
    it('accepts valid delete key', () => {
      const result = CurveKeyDeleteSchema.safeParse({ channel: 'X', time: 1.5 });
      expect(result.success).toBe(true);
    });

    it('rejects missing channel', () => {
      const result = CurveKeyDeleteSchema.safeParse({ time: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('CurveKeyUpsertSchema', () => {
    it('accepts valid upsert key', () => {
      const result = CurveKeyUpsertSchema.safeParse({
        channel: 'default',
        key: { time: 0, value: 1 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing key field', () => {
      const result = CurveKeyUpsertSchema.safeParse({ channel: 'default' });
      expect(result.success).toBe(false);
    });
  });

  describe('RichCurveKeySchema', () => {
    it('accepts valid key with time and value', () => {
      const result = RichCurveKeySchema.safeParse({ time: 0.5, value: 10 });
      expect(result.success).toBe(true);
    });

    it('rejects missing time', () => {
      const result = RichCurveKeySchema.safeParse({ value: 10 });
      expect(result.success).toBe(false);
    });
  });

  describe('CurveChannelSchema', () => {
    it('accepts channel with defaultValue and keys', () => {
      const result = CurveChannelSchema.safeParse({
        defaultValue: 0,
        keys: [{ time: 0, value: 1 }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty channel', () => {
      const result = CurveChannelSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('JsonObjectSchema', () => {
    it('accepts a flat object', () => {
      expect(JsonObjectSchema.safeParse({ key: 'value', num: 42 }).success).toBe(true);
    });

    it('rejects non-object types', () => {
      expect(JsonObjectSchema.safeParse('string').success).toBe(false);
    });
  });

  describe('BuildPlatformSchema', () => {
    it('accepts Win64', () => {
      expect(BuildPlatformSchema.safeParse('Win64').success).toBe(true);
    });

    it('rejects invalid platform', () => {
      expect(BuildPlatformSchema.safeParse('Android').success).toBe(false);
    });
  });

  describe('BuildConfigurationSchema', () => {
    it('accepts Development', () => {
      expect(BuildConfigurationSchema.safeParse('Development').success).toBe(true);
    });

    it('rejects invalid configuration', () => {
      expect(BuildConfigurationSchema.safeParse('Release').success).toBe(false);
    });
  });

  describe('EnhancedInputValueTypeSchema', () => {
    it('accepts boolean', () => {
      expect(EnhancedInputValueTypeSchema.safeParse('boolean').success).toBe(true);
    });

    it('rejects invalid value type', () => {
      expect(EnhancedInputValueTypeSchema.safeParse('quaternion').success).toBe(false);
    });
  });

  describe('InputMappingSchema', () => {
    it('accepts valid mapping', () => {
      const result = InputMappingSchema.safeParse({ action: 'IA_Jump', key: 'SpaceBar' });
      expect(result.success).toBe(true);
    });

    it('rejects missing action', () => {
      const result = InputMappingSchema.safeParse({ key: 'SpaceBar' });
      expect(result.success).toBe(false);
    });
  });

  describe('ExtractAssetTypeSchema', () => {
    it('accepts data_asset', () => {
      expect(ExtractAssetTypeSchema.safeParse('data_asset').success).toBe(true);
    });

    it('rejects invalid type', () => {
      expect(ExtractAssetTypeSchema.safeParse('texture').success).toBe(false);
    });
  });

  describe('MaterialScalarParameterSchema', () => {
    it('accepts valid scalar parameter', () => {
      const result = MaterialScalarParameterSchema.safeParse({ name: 'Roughness', value: 0.5 });
      expect(result.success).toBe(true);
    });

    it('rejects missing value', () => {
      const result = MaterialScalarParameterSchema.safeParse({ name: 'Roughness' });
      expect(result.success).toBe(false);
    });
  });

  describe('MaterialVectorParameterSchema', () => {
    it('accepts valid vector parameter', () => {
      const result = MaterialVectorParameterSchema.safeParse({
        name: 'Color',
        value: { r: 1, g: 0, b: 0, a: 1 },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid color value', () => {
      const result = MaterialVectorParameterSchema.safeParse({
        name: 'Color',
        value: { r: 1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MaterialTextureParameterSchema', () => {
    it('accepts valid texture parameter', () => {
      const result = MaterialTextureParameterSchema.safeParse({
        name: 'BaseColor',
        value: '/Game/Textures/T_Base',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing name', () => {
      const result = MaterialTextureParameterSchema.safeParse({
        value: '/Game/Textures/T_Base',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MaterialStaticSwitchParameterSchema', () => {
    it('accepts valid static switch', () => {
      const result = MaterialStaticSwitchParameterSchema.safeParse({
        name: 'UseOverlay',
        value: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-boolean value', () => {
      const result = MaterialStaticSwitchParameterSchema.safeParse({
        name: 'UseOverlay',
        value: 'yes',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('WidgetNodeSchema', () => {
    it('accepts valid widget node with children', () => {
      const result = WidgetNodeSchema.safeParse({
        class: 'CanvasPanel',
        name: 'Root',
        children: [{
          class: 'TextBlock',
          name: 'Label',
        }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects widget missing class', () => {
      const result = WidgetNodeSchema.safeParse({ name: 'Root' });
      expect(result.success).toBe(false);
    });
  });

  describe('Mutation operation schemas', () => {
    it('UserDefinedStructMutationOperationSchema accepts replace_fields', () => {
      expect(UserDefinedStructMutationOperationSchema.safeParse('replace_fields').success).toBe(true);
    });

    it('UserDefinedStructMutationOperationSchema rejects unknown operation', () => {
      expect(UserDefinedStructMutationOperationSchema.safeParse('delete_all').success).toBe(false);
    });

    it('UserDefinedEnumMutationOperationSchema accepts replace_entries', () => {
      expect(UserDefinedEnumMutationOperationSchema.safeParse('replace_entries').success).toBe(true);
    });

    it('UserDefinedEnumMutationOperationSchema rejects unknown operation', () => {
      expect(UserDefinedEnumMutationOperationSchema.safeParse('delete_all').success).toBe(false);
    });

    it('BlackboardMutationOperationSchema accepts replace_keys', () => {
      expect(BlackboardMutationOperationSchema.safeParse('replace_keys').success).toBe(true);
    });

    it('BlackboardMutationOperationSchema rejects unknown operation', () => {
      expect(BlackboardMutationOperationSchema.safeParse('clear_all').success).toBe(false);
    });

    it('BehaviorTreeMutationOperationSchema accepts replace_tree', () => {
      expect(BehaviorTreeMutationOperationSchema.safeParse('replace_tree').success).toBe(true);
    });

    it('BehaviorTreeMutationOperationSchema rejects unknown operation', () => {
      expect(BehaviorTreeMutationOperationSchema.safeParse('nuke').success).toBe(false);
    });

    it('StateTreeMutationOperationSchema accepts patch_state', () => {
      expect(StateTreeMutationOperationSchema.safeParse('patch_state').success).toBe(true);
    });

    it('StateTreeMutationOperationSchema rejects unknown operation', () => {
      expect(StateTreeMutationOperationSchema.safeParse('reset').success).toBe(false);
    });

    it('AnimSequenceMutationOperationSchema accepts replace_notifies', () => {
      expect(AnimSequenceMutationOperationSchema.safeParse('replace_notifies').success).toBe(true);
    });

    it('AnimSequenceMutationOperationSchema rejects unknown operation', () => {
      expect(AnimSequenceMutationOperationSchema.safeParse('clear').success).toBe(false);
    });

    it('BlendSpaceMutationOperationSchema accepts replace_samples', () => {
      expect(BlendSpaceMutationOperationSchema.safeParse('replace_samples').success).toBe(true);
    });

    it('BlendSpaceMutationOperationSchema rejects unknown operation', () => {
      expect(BlendSpaceMutationOperationSchema.safeParse('clear').success).toBe(false);
    });
  });
});

import {
  CompositeStepResultSchema,
  CompositeToolResultSchema,
} from '../src/schemas/tool-results.js';

describe('Schema validation — composite tool results', () => {
  describe('CompositeStepResultSchema', () => {
    it('accepts a minimal valid step', () => {
      const result = CompositeStepResultSchema.safeParse({ step: 'search', status: 'success' });
      expect(result.success).toBe(true);
    });

    it('accepts a step with all optional fields', () => {
      const result = CompositeStepResultSchema.safeParse({
        step: 'extract',
        status: 'failure',
        message: 'Asset not found',
        data: { path: '/Game/BP' },
        diagnostics: [{ severity: 'error', code: 'NOT_FOUND', message: 'Missing', path: '/Game/BP' }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects step with invalid status', () => {
      const result = CompositeStepResultSchema.safeParse({ step: 'search', status: 'pending' });
      expect(result.success).toBe(false);
    });

    it('rejects step without step name', () => {
      const result = CompositeStepResultSchema.safeParse({ status: 'success' });
      expect(result.success).toBe(false);
    });
  });

  describe('CompositeToolResultSchema', () => {
    it('accepts a valid composite success result', () => {
      const result = CompositeToolResultSchema.safeParse({
        success: true,
        operation: 'find_and_extract',
        steps: [
          { step: 'search', status: 'success' },
          { step: 'extract', status: 'success' },
        ],
        execution: { mode: 'immediate', task_support: 'forbidden' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a composite failure with partial_state', () => {
      const result = CompositeToolResultSchema.safeParse({
        success: false,
        operation: 'find_and_extract',
        steps: [
          { step: 'search', status: 'success' },
          { step: 'extract', status: 'failure', message: 'Not found' },
        ],
        partial_state: {
          completed_steps: ['search'],
          failed_step: 'extract',
          editor_state: 'No mutations performed',
        },
        execution: { mode: 'immediate', task_support: 'forbidden' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects result without steps array', () => {
      const result = CompositeToolResultSchema.safeParse({
        success: true,
        operation: 'find_and_extract',
        execution: { mode: 'immediate', task_support: 'forbidden' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects partial_state missing required fields', () => {
      const result = CompositeToolResultSchema.safeParse({
        success: false,
        operation: 'op',
        steps: [{ step: 'a', status: 'failure' }],
        partial_state: { completed_steps: ['a'] },
        execution: { mode: 'immediate', task_support: 'forbidden' },
      });
      expect(result.success).toBe(false);
    });
  });
});
