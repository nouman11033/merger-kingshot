#!/usr/bin/env node
/**
 * Inspects the real Kingshot Stats API response for an alliance and prints its
 * structure, so the normalizer in lib/kingshot.ts can be verified against live
 * data. The API key is read from the environment and never printed.
 *
 * Usage:
 *   npm run kingshot:inspect -- <kingdomId> <allianceTag>
 *   KINGSHOT_API_KEY=kss_… node scripts/inspect-kingshot-api.mjs 1234 ABC
 */

const [kingdomId, allianceTag] = process.argv.slice(2);
const apiKey = process.env.KINGSHOT_API_KEY?.trim();
const baseUrl = (process.env.KINGSHOT_API_BASE_URL?.trim() || "https://api.kingshotstats.com/v1").replace(
  /\/+$/,
  "",
);

if (!apiKey) {
  console.error("KINGSHOT_API_KEY is not set. Add it to .env.local first.");
  process.exit(1);
}
if (!kingdomId || !allianceTag) {
  console.error("Usage: npm run kingshot:inspect -- <kingdomId> <allianceTag>");
  process.exit(1);
}

const url = `${baseUrl}/alliances/${encodeURIComponent(kingdomId)}/${encodeURIComponent(
  allianceTag,
)}?include=info,roster`;

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${apiKey}`, "X-Api-Key": apiKey, Accept: "application/json" },
});

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.error(`HTTP ${response.status}: response was not JSON.`);
  console.error(text.slice(0, 500));
  process.exit(1);
}

if (!response.ok || payload?.ok === false) {
  console.error(`HTTP ${response.status}:`, payload);
  process.exit(1);
}

const describe = (value) => {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  return typeof value;
};

console.log(`GET ${url.replace(/\?.*/, "")}?include=info,roster -> HTTP ${response.status}\n`);

console.log("Top-level keys:");
for (const [key, value] of Object.entries(payload)) {
  console.log(`  ${key}: ${describe(value)}`);
}

const alliance = payload.alliance ?? payload.info ?? payload.data?.alliance;
if (alliance && typeof alliance === "object") {
  console.log("\nAlliance keys:");
  for (const [key, value] of Object.entries(alliance)) {
    console.log(`  ${key}: ${describe(value)} = ${JSON.stringify(value)?.slice(0, 60)}`);
  }
}

const members =
  payload.members ?? payload.roster ?? payload.data?.members ?? payload.data?.roster ?? null;

if (Array.isArray(members)) {
  console.log(`\nMembers: array(${members.length})`);
  if (members[0]) {
    console.log("First member keys:");
    for (const [key, value] of Object.entries(members[0])) {
      console.log(`  ${key}: ${describe(value)} = ${JSON.stringify(value)?.slice(0, 60)}`);
    }

    const ranks = members.map((member) => member.alliance_rank).filter((rank) => rank != null);
    const distinct = new Set(ranks);
    console.log(
      `\nalliance_rank: ${ranks.length}/${members.length} present, ${distinct.size} distinct, max ${
        ranks.length ? Math.max(...ranks) : "n/a"
      }`,
    );
    console.log(
      distinct.size === members.length
        ? "  -> unique positions, used directly as roster rank."
        : "  -> not unique (looks like an alliance role), roster rank is derived from power.",
    );
  }
} else {
  console.log("\nNo members array found at the expected paths — check the keys printed above.");
}

console.log(
  `\nFreshness: fresh=${payload.fresh} cached_at=${payload.cached_at} age_seconds=${payload.age_seconds}`,
);
