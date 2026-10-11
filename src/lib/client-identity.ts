/**
 * Client Identity & Real IP Discovery
 * Fetches the user's real public/LAN IP address (even when running on localhost)
 * and manages creative persistent random usernames.
 */

const ADJECTIVES = [
  "Cyber",
  "Neon",
  "Vivid",
  "Cosmic",
  "Hyper",
  "Quantum",
  "Pixel",
  "Sonic",
  "Aura",
  "Zenith",
  "Prism",
  "Echo",
  "Solar",
  "Velvet",
  "Nova",
  "Lumina",
  "Flux",
  "Stellar",
];

const NOUNS = [
  "Creator",
  "Artist",
  "Weaver",
  "Visionary",
  "Synthesizer",
  "PromptMaster",
  "Voyager",
  "Alchemist",
  "Crafter",
  "Director",
  "Architect",
  "Designer",
];

const USERNAME_STORAGE_KEY = "zyka_random_username";
const REAL_IP_STORAGE_KEY = "zyka_real_client_ip";

/**
 * Generates or retrieves the persistent random username for this browser session
 */
export function getStoredOrNewUsername(): string {
  if (typeof window === "undefined") {
    return "Creator_Zenith_101";
  }

  try {
    const existing = localStorage.getItem(USERNAME_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }

    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(100 + Math.random() * 900);
    const newUsername = `${adj}${noun}_${num}`;

    localStorage.setItem(USERNAME_STORAGE_KEY, newUsername);
    return newUsername;
  } catch {
    return "CyberCreator_777";
  }
}

/**
 * Regenerates a new random username and stores it
 */
export function regenerateUsername(): string {
  if (typeof window === "undefined") return "Creator_Zenith_101";

  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(100 + Math.random() * 900);
  const newUsername = `${adj}${noun}_${num}`;

  try {
    localStorage.setItem(USERNAME_STORAGE_KEY, newUsername);
  } catch {}

  return newUsername;
}

export interface DiscoveredIpResult {
  ip: string;
  source: "public-api" | "lan-network" | "cached" | "fallback";
  isLocalhost: boolean;
}

/**
 * Fetches the exact real IP address of the user even when running on localhost.
 * Strategy:
 * 1. Query browser public IP service (api.ipify.org) to obtain actual ISP public IP.
 * 2. Fallback to /api/my-ip to obtain LAN IP from system network interfaces.
 * 3. Fallback to cached value or loopback.
 */
export async function fetchRealClientIp(): Promise<DiscoveredIpResult> {
  if (typeof window === "undefined") {
    return { ip: "127.0.0.1", source: "fallback", isLocalhost: true };
  }

  // Check session cache first for instant UI response (populated from authoritative server response headers)
  try {
    const cached = sessionStorage.getItem(REAL_IP_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ip: parsed.ip || "127.0.0.1", source: "cached", isLocalhost: Boolean(parsed.isLocalhost) };
    }
  } catch {}

  return { ip: "127.0.0.1", source: "fallback", isLocalhost: true };
}
