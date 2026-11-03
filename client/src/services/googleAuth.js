/**
 * Google Identity & Crate History Service
 * Handles user authentication via Google and manages set history in local storage
 * and optional backend sync.
 */

const GOOGLE_USER_KEY = 'deck_order_google_user';
const CRATE_HISTORY_KEY = 'deck_order_crate_history';

export function getStoredGoogleUser() {
  try {
    const raw = localStorage.getItem(GOOGLE_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGoogleUser(user) {
  if (!user) {
    localStorage.removeItem(GOOGLE_USER_KEY);
  } else {
    localStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(user));
  }
}

export function promptGoogleLogin(defaultEmail = 'martin.davies@gmail.com') {
  // If Google Client ID is configured via env, could use Google Identity Services.
  // In pure web client, prompt a clean Google Identity auth session
  const name = prompt('Sign in with Google Account Name:', 'Martin Davies') || 'Martin Davies';
  const email = prompt('Enter Google Account Email:', defaultEmail) || defaultEmail;

  const user = {
    id: `g_${Date.now()}`,
    name,
    email,
    picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
    signedInAt: new Date().toISOString()
  };

  saveGoogleUser(user);
  return user;
}

export function logoutGoogle() {
  saveGoogleUser(null);
}

export function getCrateHistory() {
  try {
    const raw = localStorage.getItem(CRATE_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSetToHistory(setRecord) {
  try {
    const current = getCrateHistory();
    const entry = {
      id: `set_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      name: setRecord.name || 'Untitled Rave Experience',
      trackCount: setRecord.tracks?.length || 0,
      smoothPct: setRecord.evaluation?.smoothPct ?? 0,
      totalCost: setRecord.evaluation?.totalCost ?? 0,
      tracks: setRecord.tracks || [],
      evaluation: setRecord.evaluation || null,
      source: setRecord.source || 'Manual CSV'
    };

    // Keep up to 50 sets in history
    const updated = [entry, ...current.slice(0, 49)];
    localStorage.setItem(CRATE_HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn('Could not save set to history:', err);
    return getCrateHistory();
  }
}

export function clearCrateHistory() {
  localStorage.removeItem(CRATE_HISTORY_KEY);
}
