import { afterEach, describe, expect, it, vi } from 'vitest';
import { callSubsystemJson, normalizeUStructPath, normalizeUStructPaths } from '../src/helpers/subsystem.js';

function fakeClient(response: string) {
  return {
    callSubsystem: vi.fn().mockResolvedValue(response),
  };
}

describe('callSubsystemJson', () => {
  const originalEnv = process.env.MCP_DEBUG_RESPONSES;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MCP_DEBUG_RESPONSES;
    } else {
      process.env.MCP_DEBUG_RESPONSES = originalEnv;
    }
  });

  it('returns parsed JSON for a valid response', async () => {
    const client = fakeClient(JSON.stringify({ success: true, data: [1, 2, 3] }));
    const result = await callSubsystemJson(client, 'ListAssets', {});
    expect(result).toEqual({ success: true, data: [1, 2, 3] });
  });

  it('throws on parsed.error string', async () => {
    const client = fakeClient(JSON.stringify({ error: 'Asset not found' }));
    await expect(callSubsystemJson(client, 'ExtractBlueprint', {})).rejects.toThrow('Asset not found');
  });

  it('throws on success:false with explicit message field', async () => {
    const client = fakeClient(JSON.stringify({ success: false, message: 'Compilation failed' }));
    await expect(callSubsystemJson(client, 'CompileWidget', {})).rejects.toThrow('Compilation failed');
  });

  it('throws on success:false with explicit errorMessage field', async () => {
    const client = fakeClient(JSON.stringify({ success: false, errorMessage: 'Invalid parameters' }));
    await expect(callSubsystemJson(client, 'ModifyWidget', {})).rejects.toThrow('Invalid parameters');
  });

  it('passes through success:false without explicit error message for tool orchestration', async () => {
    const client = fakeClient(JSON.stringify({
      success: false,
      operation: 'trigger_live_coding',
      status: 'unsupported',
      fallbackRecommended: true,
    }));
    const result = await callSubsystemJson(client, 'TriggerLiveCoding', {});
    expect(result).toEqual({
      success: false,
      operation: 'trigger_live_coding',
      status: 'unsupported',
      fallbackRecommended: true,
    });
  });

  it('throws on errors array with string entries', async () => {
    const client = fakeClient(JSON.stringify({ errors: ['field X is required', 'field Y is invalid'] }));
    await expect(callSubsystemJson(client, 'CreateBlueprint', {})).rejects.toThrow('field X is required');
  });

  it('throws on errors array with object entries', async () => {
    const client = fakeClient(JSON.stringify({ errors: [{ code: 'INVALID', message: 'Bad input' }] }));
    await expect(callSubsystemJson(client, 'CreateBlueprint', {})).rejects.toThrow('Bad input');
  });

  it('throws on empty object response', async () => {
    const client = fakeClient(JSON.stringify({}));
    await expect(callSubsystemJson(client, 'ListAssets', {})).rejects.toThrow('Empty response from subsystem');
  });

  it('does not throw on a response with only non-error fields', async () => {
    const client = fakeClient(JSON.stringify({ items: [] }));
    const result = await callSubsystemJson(client, 'ListAssets', {});
    expect(result).toEqual({ items: [] });
  });

  it('threads options.timeoutMs to the client', async () => {
    const client = fakeClient(JSON.stringify({ ok: true }));
    await callSubsystemJson(client, 'ListAssets', { PackagePath: '/Game' }, { timeoutMs: 5000 });
    expect(client.callSubsystem).toHaveBeenCalledWith(
      'ListAssets',
      { PackagePath: '/Game' },
      { timeoutMs: 5000 },
    );
  });

  it('logs to stderr when MCP_DEBUG_RESPONSES is set', async () => {
    process.env.MCP_DEBUG_RESPONSES = '1';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const client = fakeClient(JSON.stringify({ ok: true }));

    await callSubsystemJson(client, 'TestMethod', {});

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MCP_DEBUG] TestMethod raw response:'),
    );
    stderrSpy.mockRestore();
  });

  it('does not log when MCP_DEBUG_RESPONSES is not set', async () => {
    delete process.env.MCP_DEBUG_RESPONSES;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const client = fakeClient(JSON.stringify({ ok: true }));

    await callSubsystemJson(client, 'TestMethod', {});

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('throws on { success: false } with diagnostics array', async () => {
    const fakeClient = {
      callSubsystem: async () => JSON.stringify({
        success: false,
        diagnostics: [
          { severity: 'error', message: 'Schema class not found: /Script/Foo.BarSchema' },
          { severity: 'error', message: 'nodeStructType not resolved: /Script/Foo.BazTask' },
        ],
      }),
    };

    await expect(callSubsystemJson(fakeClient, 'CreateStateTree', {}))
      .rejects.toThrow('Schema class not found');
  });

  it('passes through { success: false } without diagnostics for orchestration', async () => {
    const fakeClient = {
      callSubsystem: async () => JSON.stringify({
        success: false,
        strategy: 'build_and_restart',
      }),
    };

    const result = await callSubsystemJson(fakeClient, 'SyncProjectCode', {});
    expect(result.success).toBe(false);
    expect(result.strategy).toBe('build_and_restart');
  });

  it('preserves ueResponse on errors thrown from { error: "..." } responses', async () => {
    const fakeClient = {
      callSubsystem: async () => JSON.stringify({
        error: 'Component not found',
        errorCode: 'COMPONENT_NOT_FOUND',
        details: { componentName: 'Foo' },
      }),
    };

    try {
      await callSubsystemJson(fakeClient, 'PatchComponent', {});
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toBe('Component not found');
      expect(err.ueResponse).toBeDefined();
      expect(err.ueResponse.errorCode).toBe('COMPONENT_NOT_FOUND');
      expect(err.ueResponse.details).toEqual({ componentName: 'Foo' });
    }
  });
});

describe('normalizeUStructPath', () => {
  it('strips F prefix from USTRUCT script paths', () => {
    expect(normalizeUStructPath('/Script/CyberVolleyball6vs6.FSTCCoachIsRallyActive'))
      .toBe('/Script/CyberVolleyball6vs6.STCCoachIsRallyActive');
  });

  it('strips F prefix from another USTRUCT example', () => {
    expect(normalizeUStructPath('/Script/Mod.FSTCFoo'))
      .toBe('/Script/Mod.STCFoo');
  });

  it('does not strip when class name does not start with F followed by uppercase', () => {
    expect(normalizeUStructPath('/Script/Mod.Foo')).toBe('/Script/Mod.Foo');
  });

  it('does not strip from non-F-prefixed struct names', () => {
    expect(normalizeUStructPath('/Script/Mod.StateTreeDelayTask'))
      .toBe('/Script/Mod.StateTreeDelayTask');
  });

  it('does not strip F when followed by lowercase', () => {
    expect(normalizeUStructPath('/Script/Mod.FooBar')).toBe('/Script/Mod.FooBar');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeUStructPath('')).toBe('');
  });

  it('returns malformed paths unchanged', () => {
    expect(normalizeUStructPath('not-a-script-path')).toBe('not-a-script-path');
    expect(normalizeUStructPath('/Game/Blueprints/BP_Thing')).toBe('/Game/Blueprints/BP_Thing');
    expect(normalizeUStructPath('/Script/')).toBe('/Script/');
  });

  it('only matches /Script/ prefix paths', () => {
    expect(normalizeUStructPath('/Game/Module.FSTCFoo')).toBe('/Game/Module.FSTCFoo');
  });
});

describe('normalizeUStructPaths', () => {
  it('normalizes multiple paths and collects warnings', () => {
    const result = normalizeUStructPaths([
      '/Script/Mod.FSTCFoo',
      '/Script/Mod.BarTask',
      '/Script/Mod.FBazState',
    ]);
    expect(result.normalized).toEqual([
      '/Script/Mod.STCFoo',
      '/Script/Mod.BarTask',
      '/Script/Mod.BazState',
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('FSTCFoo');
    expect(result.warnings[1]).toContain('FBazState');
  });

  it('returns empty arrays for empty input', () => {
    const result = normalizeUStructPaths([]);
    expect(result.normalized).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('produces no warnings when no normalization needed', () => {
    const result = normalizeUStructPaths(['/Script/Mod.Foo', '/Script/Mod.Bar']);
    expect(result.normalized).toEqual(['/Script/Mod.Foo', '/Script/Mod.Bar']);
    expect(result.warnings).toEqual([]);
  });
});
