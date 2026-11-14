/**
 * Camelot Wheel Lookup & Harmonic Transition Engine
 * 
 * Standard Camelot Wheel mapping:
 * Major keys (B):
 *   B=1B, F#=2B, C#=3B, Ab=4B, Eb=5B, Bb=6B, F=7B, C=8B, G=9B, D=10B, A=11B, E=12B
 * Minor keys (A):
 *   G#=1A, Eb=2A, Bb=3A, F=4A, C=5A, G=6A, D=7A, A=8A, E=9A, B=10A, F#=11A, C#=12A
 * 
 * Enharmonics:
 *   C# = Db (3B / 12A), D# = Eb (5B / 2A), F# = Gb (2B / 11A),
 *   G# = Ab (4B / 1A),  A# = Bb (6B / 3A)
 * 
 * Rules:
 * 1. Mode (major/minor) is REQUIRED. If missing/ambiguous, camelot is null. Never infer mode from key name alone.
 * 2. 12 and 1 wrap around (12A is 1 step from 1A and 11A).
 */

// Pitch class normalization to canonical flat/sharp notation
const PITCH_NORMALIZATION = {
  // Enharmonic mappings
  'B#': 'C',
  'C': 'C',
  'C#': 'Db',
  'DB': 'Db',
  'D': 'D',
  'D#': 'Eb',
  'EB': 'Eb',
  'E': 'E',
  'FB': 'E',
  'E#': 'F',
  'F': 'F',
  'F#': 'Gb',
  'GB': 'Gb',
  'G': 'G',
  'G#': 'Ab',
  'AB': 'Ab',
  'A': 'A',
  'A#': 'Bb',
  'BB': 'Bb',
  'B': 'B',
  'CB': 'B'
};

// Explicit lookup table for Major keys -> B
const MAJOR_CAMELOT = {
  'B': '1B',
  'Gb': '2B', // F# / Gb
  'Db': '3B', // C# / Db
  'Ab': '4B', // G# / Ab
  'Eb': '5B', // D# / Eb
  'Bb': '6B', // A# / Bb
  'F': '7B',
  'C': '8B',
  'G': '9B',
  'D': '10B',
  'A': '11B',
  'E': '12B'
};

// Explicit lookup table for Minor keys -> A
const MINOR_CAMELOT = {
  'Ab': '1A', // G# / Ab
  'Eb': '2A', // D# / Eb
  'Bb': '3A', // A# / Bb
  'F': '4A',
  'C': '5A',
  'G': '6A',
  'D': '7A',
  'A': '8A',
  'E': '9A',
  'B': '10A',
  'Gb': '11A', // F# / Gb
  'Db': '12A'  // C# / Db
};

/**
 * Normalizes pitch name to standard pitch token
 */
export function normalizePitch(pitch) {
  if (!pitch || typeof pitch !== 'string') return null;
  const clean = pitch.trim().toUpperCase();
  // Standardize accidental casing: uppercase note letter, lowercase 'b' or '#'
  let formatted = clean.charAt(0);
  if (clean.length > 1) {
    const acc = clean.slice(1);
    if (acc === '#' || acc.toLowerCase() === 'b') {
      formatted += acc === '#' ? '#' : 'b';
    } else {
      formatted += acc.toLowerCase();
    }
  }
  const key = formatted.toUpperCase();
  return PITCH_NORMALIZATION[key] || null;
}

/**
 * Normalizes mode string to 'major' | 'minor' | null.
 * Strict: returns null if missing, empty, or ambiguous.
 */
export function normalizeMode(mode) {
  if (!mode || typeof mode !== 'string') return null;
  const m = mode.trim().toLowerCase();
  if (m === 'major' || m === 'maj' || m === 'm' && mode.trim() === 'M') {
    return 'major';
  }
  if (m === 'minor' || m === 'min' || m === 'm') {
    return 'minor';
  }
  if (m === '1' || m === 'maj') return 'major';
  if (m === '0' || m === 'min') return 'minor';
  return null;
}

/**
 * Parses a key string (e.g. "C#m", "Db major", "8A", "F# min", "G")
 * Rule: If mode is absent/ambiguous, mode is null and camelot is null.
 * Never infer mode from bare note name!
 */
export function parseKey(rawKey, rawMode = null) {
  if (!rawKey && !rawMode) {
    return { pitch: null, mode: null, camelot: null, raw: rawKey };
  }

  const str = String(rawKey || '').trim();

  // 1. Direct Camelot string check (e.g. "8A", "11B", "1b", "12a")
  const camelotMatch = str.match(/^([1-9]|1[0-2])([AaBb])$/);
  if (camelotMatch) {
    const num = parseInt(camelotMatch[1], 10);
    const letter = camelotMatch[2].toUpperCase();
    return {
      pitch: null,
      mode: letter === 'B' ? 'major' : 'minor',
      camelot: `${num}${letter}`,
      raw: str
    };
  }

  let pitchCandidate = null;
  let modeCandidate = normalizeMode(rawMode);

  // 2. Parse from single composite string like "C# minor", "F#m", "Ab maj"
  // Look for note: A-G, optional # or b
  const keyRegex = /^([A-Ga-g][#b]?)(.*)$/;
  const match = str.match(keyRegex);

  if (match) {
    pitchCandidate = normalizePitch(match[1]);
    const remainder = match[2].trim();

    if (remainder) {
      if (/^(min|minor|m)$/i.test(remainder)) {
        modeCandidate = 'minor';
      } else if (/^(maj|major|M)$/.test(remainder)) {
        modeCandidate = 'major';
      } else if (/^major$/i.test(remainder)) {
        modeCandidate = 'major';
      }
    }
  }

  // 3. Strict mode check: mode is REQUIRED for Camelot
  if (!pitchCandidate || !modeCandidate) {
    return {
      pitch: pitchCandidate,
      mode: modeCandidate,
      camelot: null,
      raw: str,
      unverifiedReason: !modeCandidate ? 'Missing or ambiguous mode (major/minor required)' : 'Unrecognized pitch'
    };
  }

  // 4. Lookup in explicit table
  const camelot = modeCandidate === 'major'
    ? MAJOR_CAMELOT[pitchCandidate]
    : MINOR_CAMELOT[pitchCandidate];

  return {
    pitch: pitchCandidate,
    mode: modeCandidate,
    camelot: camelot || null,
    raw: str
  };
}

/**
 * Calculates step distance on the 12-hour Camelot wheel.
 * Explicitly wraps between 12 and 1.
 * Returns { stepDiff, directedStep } where:
 *   stepDiff: shortest distance (0 to 6)
 *   directedStep: signed difference (+1 = one step up, -1 = one step down)
 */
export function getWheelDistance(num1, num2) {
  const n1 = parseInt(num1, 10);
  const n2 = parseInt(num2, 10);
  if (isNaN(n1) || isNaN(n2) || n1 < 1 || n1 > 12 || n2 < 1 || n2 > 12) {
    return { stepDiff: null, directedStep: null };
  }

  // Direct clockwise step from n1 to n2
  let clockwise = (n2 - n1 + 12) % 12;
  // Direct counter-clockwise step from n1 to n2
  let counterClockwise = (n1 - n2 + 12) % 12;

  let stepDiff = Math.min(clockwise, counterClockwise);
  let directedStep = clockwise <= 6 ? clockwise : -counterClockwise;

  return { stepDiff, directedStep };
}

/**
 * Evaluates harmonic transition between two Camelot values (from A -> to B)
 * Cost rules (per Phase 2.1):
 * - same key = 0
 * - relative major/minor (same number, A<->B) = 1
 * - adjacent same letter (+/-1 number) = 1
 * - +/-2 same letter = 2 (energy lift/drop)
 * - beyond that = high cost (5 + stepDiff)
 * - unverified / null = null (treated per unverified strategy)
 */
export function evaluateHarmonicTransition(camA, camB) {
  if (!camA || !camB) {
    return {
      cost: null,
      grade: 'UNVERIFIED',
      relation: 'Unknown / Unverified harmonic data',
      stepDiff: null,
      isCompatible: false
    };
  }

  const matchA = camA.match(/^(\d{1,2})([AB])$/);
  const matchB = camB.match(/^(\d{1,2})([AB])$/);

  if (!matchA || !matchB) {
    return {
      cost: null,
      grade: 'UNVERIFIED',
      relation: 'Invalid Camelot code',
      stepDiff: null,
      isCompatible: false
    };
  }

  const numA = parseInt(matchA[1], 10);
  const letterA = matchA[2];
  const numB = parseInt(matchB[1], 10);
  const letterB = matchB[2];

  const { stepDiff, directedStep } = getWheelDistance(numA, numB);

  // Exact same key
  if (numA === numB && letterA === letterB) {
    return {
      cost: 0,
      grade: 'SMOOTH',
      relation: `${camA} to ${camB} - same key`,
      stepDiff: 0,
      directedStep: 0,
      isCompatible: true
    };
  }

  // Relative major/minor (same number, different letter)
  if (numA === numB && letterA !== letterB) {
    const relType = letterB === 'B' ? 'relative major' : 'relative minor';
    return {
      cost: 1,
      grade: 'SMOOTH',
      relation: `${camA} to ${camB} - ${relType}`,
      stepDiff: 0,
      directedStep: 0,
      isCompatible: true
    };
  }

  // Same mode (same letter)
  if (letterA === letterB) {
    if (stepDiff === 1) {
      const dirText = directedStep === 1
        ? (numA === 12 && numB === 1 ? 'one step up (wheel wrap 12->1)' : 'one step up')
        : (numA === 1 && numB === 12 ? 'one step down (wheel wrap 1->12)' : 'one step down');
      return {
        cost: 1,
        grade: 'SMOOTH',
        relation: `${camA} to ${camB} - ${dirText}`,
        stepDiff: 1,
        directedStep,
        isCompatible: true
      };
    }

    if (stepDiff === 2) {
      const dirText = directedStep === 2
        ? 'two steps up (+2 energy boost)'
        : 'two steps down (-2 energy drop)';
      return {
        cost: 2,
        grade: 'SMOOTH',
        relation: `${camA} to ${camB} - ${dirText}`,
        stepDiff: 2,
        directedStep,
        isCompatible: true
      };
    }

    // Step distance >= 3 in same mode
    return {
      cost: 5 + stepDiff,
      grade: stepDiff === 3 ? 'STRETCH' : 'CLASH',
      relation: `${camA} to ${camB} - ${stepDiff} steps away (jump)`,
      stepDiff,
      directedStep,
      isCompatible: false
    };
  }

  // Different mode (different letter) AND different number
  if (stepDiff === 1) {
    // Diagonal jump: e.g. 8A to 9B or 8A to 7B
    return {
      cost: 3,
      grade: 'STRETCH',
      relation: `${camA} to ${camB} - diagonal transition (+/-1 and mode change)`,
      stepDiff: 1,
      directedStep,
      isCompatible: false
    };
  }

  return {
    cost: 7 + stepDiff,
    grade: 'CLASH',
    relation: `${camA} to ${camB} - harmonic clash (${stepDiff} steps + mode change)`,
    stepDiff,
    directedStep,
    isCompatible: false
  };
}
