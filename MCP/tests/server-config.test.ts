import { describe, expect, it } from 'vitest';
import { classifyRecoverableToolFailure } from '../src/server-config.js';

describe('classifyRecoverableToolFailure', () => {
  it('classifies timeout patterns as recoverable', () => {
    const patterns = [
      'Request timed out after 60000ms',
      'Connection timeout while connecting',
      'ETIMEDOUT connecting to 127.0.0.1:30010',
      'ESOCKETTIMEDOUT on remote call',
    ];

    for (const message of patterns) {
      const result = classifyRecoverableToolFailure('create_blueprint', message);
      expect(result, `Expected classification for: "${message}"`).not.toBeNull();
      expect(result!.code).toBe('timeout');
      expect(result!.recoverable).toBe(true);
      expect(result!.retry_after_ms).toBe(5000);
    }
  });

  it('classifies JSON parse error patterns as recoverable', () => {
    const patterns = [
      'Unexpected token < in JSON at position 0',
      'SyntaxError: Unexpected end of JSON input',
      'JSON.parse: unexpected character at line 1',
    ];

    for (const message of patterns) {
      const result = classifyRecoverableToolFailure('extract_blueprint', message);
      expect(result, `Expected classification for: "${message}"`).not.toBeNull();
      expect(result!.code).toBe('invalid_response');
      expect(result!.recoverable).toBe(true);
    }
  });

  it('classifies DLL lock patterns as recoverable', () => {
    const patterns = [
      'The process cannot access the file because it is locked by another process',
      'Cannot write to locked file: MyGame.dll',
      'Build failed: cannot access the file because it is being used',
    ];

    for (const message of patterns) {
      const result = classifyRecoverableToolFailure('compile_project_code', message);
      expect(result, `Expected classification for: "${message}"`).not.toBeNull();
      expect(result!.code).toBe('locked_file');
      expect(result!.recoverable).toBe(true);
    }
  });

  it('classifies empty response patterns as recoverable', () => {
    const patterns = [
      'Empty response from subsystem',
      'Received empty response from the editor',
      '',
    ];

    for (const message of patterns) {
      const result = classifyRecoverableToolFailure('extract_blueprint', message);
      expect(result, `Expected classification for: "${message}"`).not.toBeNull();
      expect(result!.code).toBe('empty_response');
      expect(result!.recoverable).toBe(true);
    }
  });

  it('classifies editor unavailable as recoverable', () => {
    const result = classifyRecoverableToolFailure(
      'create_blueprint',
      'UE Editor not running or Remote Control not available on 127.0.0.1:30010',
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe('editor_unavailable');
    expect(result!.recoverable).toBe(true);
  });

  it('classifies subsystem unavailable as recoverable', () => {
    const result = classifyRecoverableToolFailure(
      'extract_blueprint',
      'BlueprintExtractor subsystem not found. Ensure the plugin is loaded.',
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe('subsystem_unavailable');
    expect(result!.recoverable).toBe(true);
  });

  it('classifies engine root missing as non-recoverable', () => {
    const result = classifyRecoverableToolFailure(
      'compile_project_code',
      'This operation requires engine_root or UE_ENGINE_ROOT to be set',
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe('engine_root_missing');
    expect(result!.recoverable).toBe(false);
  });

  it('returns null for unrecognized error messages', () => {
    const result = classifyRecoverableToolFailure('create_blueprint', 'Something completely unexpected');
    expect(result).toBeNull();
  });
});
