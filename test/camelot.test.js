import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKey,
  getWheelDistance,
  evaluateHarmonicTransition,
  normalizePitch,
  normalizeMode
} from '../server/core/camelot.js';

describe('Camelot Wheel & Key Normalizer Tests', () => {

  test('All 12 Major keys map correctly to B numbers', () => {
    const majorExpected = {
      'B major': '1B',
      'F# major': '2B',
      'Gb major': '2B',
      'C# major': '3B',
      'Db major': '3B',
      'Ab major': '4B',
      'G# major': '4B',
      'Eb major': '5B',
      'D# major': '5B',
      'Bb major': '6B',
      'A# major': '6B',
      'F major': '7B',
      'C major': '8B',
      'G major': '9B',
      'D major': '10B',
      'A major': '11B',
      'E major': '12B'
    };

    for (const [keyName, expectedCamelot] of Object.entries(majorExpected)) {
      const parsed = parseKey(keyName);
      assert.equal(
        parsed.camelot,
        expectedCamelot,
        `Expected ${keyName} to map to ${expectedCamelot}, got ${parsed.camelot}`
      );
      assert.equal(parsed.mode, 'major');
    }
  });

  test('All 12 Minor keys map correctly to A numbers', () => {
    const minorExpected = {
      'G# minor': '1A',
      'Ab minor': '1A',
      'Eb minor': '2A',
      'D# minor': '2A',
      'Bb minor': '3A',
      'A# minor': '3A',
      'F minor': '4A',
      'C minor': '5A',
      'G minor': '6A',
      'D minor': '7A',
      'A minor': '8A',
      'E minor': '9A',
      'B minor': '10A',
      'F# minor': '11A',
      'Gb minor': '11A',
      'C# minor': '12A',
      'Db minor': '12A'
    };

    for (const [keyName, expectedCamelot] of Object.entries(minorExpected)) {
      const parsed = parseKey(keyName);
      assert.equal(
        parsed.camelot,
        expectedCamelot,
        `Expected ${keyName} to map to ${expectedCamelot}, got ${parsed.camelot}`
      );
      assert.equal(parsed.mode, 'minor');
    }
  });

  test('Enharmonics normalize to the exact same Camelot value', () => {
    // C# major == Db major == 3B
    assert.equal(parseKey('C# major').camelot, '3B');
    assert.equal(parseKey('Db major').camelot, '3B');
    assert.equal(parseKey('C#maj').camelot, '3B');
    assert.equal(parseKey('Dbmaj').camelot, '3B');

    // D# minor == Eb minor == 2A
    assert.equal(parseKey('D# minor').camelot, '2A');
    assert.equal(parseKey('Eb minor').camelot, '2A');
    assert.equal(parseKey('D#m').camelot, '2A');
    assert.equal(parseKey('Ebm').camelot, '2A');

    // F# major == Gb major == 2B
    assert.equal(parseKey('F# major').camelot, '2B');
    assert.equal(parseKey('Gb major').camelot, '2B');

    // G# minor == Ab minor == 1A
    assert.equal(parseKey('G# minor').camelot, '1A');
    assert.equal(parseKey('Ab minor').camelot, '1A');

    // A# minor == Bb minor == 3A
    assert.equal(parseKey('A# minor').camelot, '3A');
    assert.equal(parseKey('Bb minor').camelot, '3A');
  });

  test('Direct Camelot string inputs pass through with correct mode', () => {
    assert.deepEqual(parseKey('8A'), { pitch: null, mode: 'minor', camelot: '8A', raw: '8A' });
    assert.deepEqual(parseKey('11B'), { pitch: null, mode: 'major', camelot: '11B', raw: '11B' });
    assert.deepEqual(parseKey('1a'), { pitch: null, mode: 'minor', camelot: '1A', raw: '1a' });
    assert.deepEqual(parseKey('12b'), { pitch: null, mode: 'major', camelot: '12B', raw: '12b' });
  });

  test('Mode is REQUIRED: bare key names without mode produce null camelot', () => {
    // "Never infer mode from the key name alone"
    const bareKeys = ['C', 'F#', 'G', 'Bb', 'D', 'A', 'Eb'];
    for (const key of bareKeys) {
      const parsed = parseKey(key);
      assert.equal(
        parsed.camelot,
        null,
        `Bare key '${key}' without mode must have null camelot, got ${parsed.camelot}`
      );
      assert.equal(parsed.mode, null);
    }

    // Explicit separate mode works
    const withExplicitMode = parseKey('C', 'major');
    assert.equal(withExplicitMode.camelot, '8B');

    const withExplicitMinor = parseKey('A', 'minor');
    assert.equal(withExplicitMinor.camelot, '8A');
  });

  test('Null, empty, and corrupt inputs return null camelot safely', () => {
    assert.equal(parseKey(null).camelot, null);
    assert.equal(parseKey(undefined).camelot, null);
    assert.equal(parseKey('').camelot, null);
    assert.equal(parseKey('Unknown').camelot, null);
    assert.equal(parseKey('13A').camelot, null);
    assert.equal(parseKey('0B').camelot, null);
  });

  test('Wheel wrap: 12 and 1 are adjacent (distance = 1)', () => {
    // 12 to 1 clockwise is 1 step
    const dist12to1 = getWheelDistance(12, 1);
    assert.equal(dist12to1.stepDiff, 1, 'Distance between 12 and 1 must be 1');
    assert.equal(dist12to1.directedStep, 1, '12 to 1 is one step up');

    // 1 to 12 counter-clockwise is 1 step
    const dist1to12 = getWheelDistance(1, 12);
    assert.equal(dist1to12.stepDiff, 1, 'Distance between 1 and 12 must be 1');
    assert.equal(dist1to12.directedStep, -1, '1 to 12 is one step down');

    // 12 to 11 is 1 step
    const dist12to11 = getWheelDistance(12, 11);
    assert.equal(dist12to11.stepDiff, 1);
    assert.equal(dist12to11.directedStep, -1);

    // 11 to 1 is 2 steps (via 12)
    const dist11to1 = getWheelDistance(11, 1);
    assert.equal(dist11to1.stepDiff, 2);
    assert.equal(dist11to1.directedStep, 2);

    // 12 to 2 is 2 steps (12 -> 1 -> 2)
    const dist12to2 = getWheelDistance(12, 2);
    assert.equal(dist12to2.stepDiff, 2);
    assert.equal(dist12to2.directedStep, 2);

    // 6 to 12 is 6 steps (maximum across the wheel)
    const dist6to12 = getWheelDistance(6, 12);
    assert.equal(dist6to12.stepDiff, 6);
  });

  test('Harmonic transitions evaluation and cost matrix', () => {
    // Same key -> cost 0
    const same = evaluateHarmonicTransition('8A', '8A');
    assert.equal(same.cost, 0);
    assert.equal(same.grade, 'SMOOTH');
    assert.match(same.relation, /same key/);

    // Relative major/minor -> cost 1
    const relMaj = evaluateHarmonicTransition('8A', '8B');
    assert.equal(relMaj.cost, 1);
    assert.equal(relMaj.grade, 'SMOOTH');
    assert.match(relMaj.relation, /relative major/);

    const relMin = evaluateHarmonicTransition('8B', '8A');
    assert.equal(relMin.cost, 1);
    assert.equal(relMin.grade, 'SMOOTH');
    assert.match(relMin.relation, /relative minor/);

    // Adjacent same letter -> cost 1
    const stepUp = evaluateHarmonicTransition('8A', '9A');
    assert.equal(stepUp.cost, 1);
    assert.equal(stepUp.grade, 'SMOOTH');
    assert.match(stepUp.relation, /one step up/);

    // Adjacent wrap 12A -> 1A -> cost 1
    const wrapUp = evaluateHarmonicTransition('12A', '1A');
    assert.equal(wrapUp.cost, 1);
    assert.equal(wrapUp.grade, 'SMOOTH');
    assert.match(wrapUp.relation, /wheel wrap 12->1/);

    // Adjacent wrap 1B -> 12B -> cost 1
    const wrapDown = evaluateHarmonicTransition('1B', '12B');
    assert.equal(wrapDown.cost, 1);
    assert.equal(wrapDown.grade, 'SMOOTH');
    assert.match(wrapDown.relation, /wheel wrap 1->12/);

    // Two steps same letter -> cost 2
    const twoUp = evaluateHarmonicTransition('8A', '10A');
    assert.equal(twoUp.cost, 2);
    assert.equal(twoUp.grade, 'SMOOTH');
    assert.match(twoUp.relation, /two steps up/);

    // Large step jump -> clash (>5)
    const clash = evaluateHarmonicTransition('8A', '2A');
    assert.ok(clash.cost >= 5);
    assert.equal(clash.grade, 'CLASH');

    // Unverified / null handling
    const unverified = evaluateHarmonicTransition('8A', null);
    assert.equal(unverified.cost, null);
    assert.equal(unverified.grade, 'UNVERIFIED');
  });
});
