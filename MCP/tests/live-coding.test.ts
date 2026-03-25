import { describe, expect, it } from 'vitest';
import {
  canFallbackFromLiveCoding,
  deriveLiveCodingFallbackReason,
  enrichLiveCodingResult,
} from '../src/helpers/live-coding.js';

describe('canFallbackFromLiveCoding', () => {
  it('returns true for unsupported status', () => {
    expect(canFallbackFromLiveCoding({ status: 'unsupported' })).toBe(true);
    expect(canFallbackFromLiveCoding({ status: 'Unsupported' })).toBe(true);
  });

  it('returns true for unavailable status', () => {
    expect(canFallbackFromLiveCoding({ status: 'unavailable' })).toBe(true);
  });

  it('returns true for unsupported compileResult', () => {
    expect(canFallbackFromLiveCoding({ compileResult: 'unsupported' })).toBe(true);
  });

  it('returns true for unavailable compileResult', () => {
    expect(canFallbackFromLiveCoding({ compileResult: 'unavailable' })).toBe(true);
  });

  it('returns true for nochanges compileResult', () => {
    expect(canFallbackFromLiveCoding({ compileResult: 'nochanges' })).toBe(true);
    expect(canFallbackFromLiveCoding({ compileResult: 'NoChanges' })).toBe(true);
  });

  it('returns true for unsupported reason', () => {
    expect(canFallbackFromLiveCoding({ reason: 'unsupported' })).toBe(true);
  });

  it('returns true when fallbackRecommended is true', () => {
    expect(canFallbackFromLiveCoding({ fallbackRecommended: true })).toBe(true);
  });

  it('returns true when noOp is true', () => {
    expect(canFallbackFromLiveCoding({ noOp: true })).toBe(true);
  });

  it('returns false for a successful compile result', () => {
    expect(canFallbackFromLiveCoding({
      status: 'success',
      compileResult: 'ok',
    })).toBe(false);
  });

  it('returns false for empty result', () => {
    expect(canFallbackFromLiveCoding({})).toBe(false);
  });
});

describe('deriveLiveCodingFallbackReason', () => {
  it('returns nochanges reason for nochanges compileResult', () => {
    expect(deriveLiveCodingFallbackReason({ compileResult: 'nochanges' }))
      .toBe('live_coding_reported_nochanges');
  });

  it('returns nochanges reason for noOp', () => {
    expect(deriveLiveCodingFallbackReason({ noOp: true }))
      .toBe('live_coding_reported_nochanges');
  });

  it('returns unsupported reason for unsupported status', () => {
    expect(deriveLiveCodingFallbackReason({ status: 'unsupported' }))
      .toBe('live_coding_unsupported');
  });

  it('returns unsupported reason for unsupported compileResult', () => {
    expect(deriveLiveCodingFallbackReason({ compileResult: 'unsupported' }))
      .toBe('live_coding_unsupported');
  });

  it('returns unavailable reason for unavailable status', () => {
    expect(deriveLiveCodingFallbackReason({ status: 'unavailable' }))
      .toBe('live_coding_unavailable');
  });

  it('returns unavailable reason for unavailable compileResult', () => {
    expect(deriveLiveCodingFallbackReason({ compileResult: 'unavailable' }))
      .toBe('live_coding_unavailable');
  });

  it('returns existing reason string when no special conditions match', () => {
    expect(deriveLiveCodingFallbackReason({ reason: 'custom_reason' }))
      .toBe('custom_reason');
  });

  it('returns undefined when no reason can be derived', () => {
    expect(deriveLiveCodingFallbackReason({ status: 'success' }))
      .toBeUndefined();
  });
});

describe('enrichLiveCodingResult', () => {
  it('adds header change warnings when .h files are detected', () => {
    const result = enrichLiveCodingResult(
      { status: 'success', compileResult: 'ok' },
      ['Source/MyActor.cpp', 'Source/MyActor.h'],
    );

    expect(result.headerChangesDetected).toEqual(['Source/MyActor.h']);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cannot add, remove, or reorder UPROPERTYs'),
      ]),
    );
  });

  it('detects .hpp and .inl header extensions', () => {
    const result = enrichLiveCodingResult(
      { status: 'success' },
      ['Source/Utils.hpp', 'Source/Templates.inl'],
    );

    expect(result.headerChangesDetected).toHaveLength(2);
  });

  it('does not add header warnings when no headers are changed', () => {
    const result = enrichLiveCodingResult(
      { status: 'success' },
      ['Source/MyActor.cpp'],
    );

    expect(result.headerChangesDetected).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('sets fallbackRecommended based on canFallbackFromLiveCoding', () => {
    const fallbackResult = enrichLiveCodingResult(
      { status: 'unsupported' },
      [],
    );
    expect(fallbackResult.fallbackRecommended).toBe(true);
    expect(fallbackResult.reason).toBe('live_coding_unsupported');

    const successResult = enrichLiveCodingResult(
      { status: 'success', compileResult: 'ok' },
      [],
    );
    expect(successResult.fallbackRecommended).toBe(false);
  });

  it('includes lastExternalBuild when fallback is recommended', () => {
    const lastBuild = { engineRoot: 'C:/UE', exitCode: 0 };
    const result = enrichLiveCodingResult(
      { compileResult: 'nochanges' },
      [],
      lastBuild,
    );

    expect(result.lastExternalBuild).toBe(lastBuild);
  });

  it('does not include lastExternalBuild when fallback is not recommended', () => {
    const lastBuild = { engineRoot: 'C:/UE', exitCode: 0 };
    const result = enrichLiveCodingResult(
      { status: 'success', compileResult: 'ok' },
      [],
      lastBuild,
    );

    expect(result.lastExternalBuild).toBeUndefined();
  });

  it('preserves existing warnings from the result', () => {
    const result = enrichLiveCodingResult(
      { warnings: ['existing warning'] },
      [],
    );

    expect(result.warnings).toContain('existing warning');
  });

  it('sets changedPathsAccepted and changedPathsAppliedByEditor', () => {
    const paths = ['Source/A.cpp', 'Source/B.cpp'];
    const result = enrichLiveCodingResult({ status: 'success' }, paths);

    expect(result.changedPathsAccepted).toBe(paths);
    expect(result.changedPathsAppliedByEditor).toBe(false);
  });

  it('normalizes backslash paths in header detection', () => {
    const result = enrichLiveCodingResult(
      { status: 'success' },
      ['Source\\Actors\\MyActor.h'],
    );

    expect(result.headerChangesDetected).toEqual(['Source\\Actors\\MyActor.h']);
    expect(result.warnings).toHaveLength(1);
  });

  it('adds new-file warning when noOp is true with NoChanges', () => {
    const result = enrichLiveCodingResult(
      { success: true, compileResult: 'NoChanges', noOp: true },
      ['/Game/Source/NewFile.cpp'],
    );
    expect(result.warnings).toBeDefined();
    expect((result.warnings as string[]).some((w: string) => w.includes('newly added'))).toBe(true);
  });
});
