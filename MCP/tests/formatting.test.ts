import { describe, expect, it } from 'vitest';
import {
  coerceStringArray,
  extractExtraContent,
  extractToolPayload,
  firstDefinedString,
  formatPromptBlock,
  formatPromptList,
  formatPromptValue,
  maybeBoolean,
  tryParseJsonText,
} from '../src/helpers/formatting.js';

describe('formatting helpers', () => {
  it('coerces arrays and JSON strings into cleaned string arrays', () => {
    expect(coerceStringArray(['alpha', ' ', 3, 'beta'])).toEqual(['alpha', 'beta']);
    expect(coerceStringArray('["alpha","beta",""]')).toEqual(['alpha', 'beta']);
    expect(coerceStringArray(' not-json ')).toEqual(['not-json']);
  });

  it('formats prompt values, lists, and blocks with fallbacks', () => {
    expect(formatPromptValue({ alpha: 1 })).toBe('{\n  "alpha": 1\n}');
    expect(formatPromptList('Items', ['alpha', 'beta'], 'none')).toBe('Items:\n- alpha\n- beta');
    expect(formatPromptBlock('Config', { alpha: 1 }, 'none')).toBe('Config:\n{\n  "alpha": 1\n}');
    expect(formatPromptList('Items', undefined, 'none')).toBe('none');
  });

  it('extracts tool payloads and non-text content blocks', () => {
    const structured = {
      structuredContent: { success: true, value: 1 },
      content: [{
        type: 'resource_link' as const,
        uri: 'blueprint://captures/capture-123',
        name: 'Capture',
      }],
    };
    const textOnly = {
      content: [{
        type: 'text' as const,
        text: '{"success":true,"value":2}',
      }],
    };
    const nonJsonText = {
      content: [{
        type: 'text' as const,
        text: 'plain message',
      }],
    };

    expect(extractToolPayload(structured)).toEqual({ success: true, value: 1 });
    expect(extractExtraContent(structured)).toEqual([{
      type: 'resource_link',
      uri: 'blueprint://captures/capture-123',
      name: 'Capture',
    }]);
    expect(extractToolPayload(textOnly)).toEqual({ success: true, value: 2 });
    expect(extractToolPayload(nonJsonText)).toEqual({ message: 'plain message' });
    expect(tryParseJsonText('{"ok":true}')).toEqual({ ok: true });
  });

  it('picks the first defined boolean and string values', () => {
    expect(maybeBoolean(undefined, 'true', false, true)).toBe(false);
    expect(maybeBoolean(undefined, 'true')).toBeUndefined();
    expect(firstDefinedString('', undefined, 'alpha', 'beta')).toBe('alpha');
    expect(firstDefinedString(undefined, '')).toBeUndefined();
  });
});
