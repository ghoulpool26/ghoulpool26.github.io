const fs = require('fs');

const NTFY_TOPIC = 'ghoulpool26-alerts';

const names = [
  "Robert Redford","Chuck Grassley","Lou Holtz","Deion Sanders","Ariana Grande","Paul Pelosi","Bryan Johnson","Mel Brooks","Ric Flair","Clint Eastwood","Virginia Foxx","Robert Plant","Willie Nelson","Rudy Giuliani","Kanye West","Mitch McConnell","Joe Namath","Antonio Brown","Donald Trump","Phil Knight","Dick Van Dyke","Clarence Thomas","Bernie Kosar","Julie Andrews","Dolly Parton",
  "Harvey Weinstein","King Charles","Katy Perry","Guy Fieri","Phil Mickelson","Bill Belichick","Andrew Windsor","Danny DeVito","John Kerry","Jax Taylor","Jim Carrey","George W Bush","George Strait","Nancy Pelosi","Steve Spurrier","Corey Feldman","Bill Clinton","Flavor Flav","Bruce Willis","RFK","Stephen Fry",
  "Sandy Koufax","Liver King","Ian Michelin","Harrison Ford","Buzz Aldrin","Anthony Hopkins","John Daly","Joe Biden","Salman Rushdie","Alex Murdoch","David Attenborough","Netanyahu","Kevin Spacey","Yoko Ono","Michael Caine","Patrick Stewart",
  "Caitlyn Jenner","Amanda Bynes","Jerry Sandusky","Bill Cosby","Dennis Rodman","Bam Margera","Elton John","Michael J Fox","Ghislaine Maxwell","Wendi Adelson","P Diddy","Britney Spears","Charlie Sheen","Macaulay Culkin","Demi Lovato","Casey Anthony","Mr. Feeny (Daniels)",
  "King Salman","Vladimir Putin","Bob Iger","Warren Buffett","Dan Rather","Raul Castro","Dick Greco","Andrea Mitchell","Alan Greenspan","William Shatner","Richard Shelby",
  "Wendy Williams","Naomi Campbell","Pete Doherty","Elon Musk","Carol Burnett","King Charles III","Eric Clapton","Will Smith","Woody Allen","Steven Tyler","Keith Richards","John Mulaney","Queen Camilla","Iggy Pop",
  "Pat Ryan","Burt Kreischer","John Frusciante","Jerry Jones","Jelly Roll","Morgan Freeman","MGK","Miley Cyrus","Johnny Manziel",
  "Jack Nicklaus","Ayatollah Khamenei","Lee Corso","Arthur Blank","Paul McCartney","Dick Vitale","Terry Bradshaw","Ellen DeGeneres","John Thune","Joe Pesci","Mack Brown",
  "Marjorie Taylor Greene","Usha Vance","Snoop Dogg","Drew Barrymore","Kylie Jenner","Timothée Chalamet","Mischa Barton"
];

const uniqueNames = [...new Set(names)];
const BATCH_SIZE = 10;

// ── Load existing deaths (append-only) ──────────────────────
let existingDeaths = [];
let knownDeadNames = new Set();
try {
  const prev = JSON.parse(fs.readFileSync('deaths.json', 'utf8'));
  existingDeaths = prev.deaths || [];
  existingDeaths.forEach(d => knownDeadNames.add(d.name));
  console.log(`Loaded ${existingDeaths.length} previously known death(s).`);
} catch {
  console.log('No previous deaths.json found — first run.');
}

// ── Helpers ─────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── ntfy notification ───────────────────────────────────────
async function sendNtfyAlert(death) {
  if (!NTFY_TOPIC) return;

  const body = JSON.stringify({
    topic: NTFY_TOPIC,
    title: `☠️ ${death.name} has died`,
    message: [
      death.date ? `Date: ${death.date}` : null,
      death.source_name ? `Source: ${death.source_name}` : null,
      '',
      'https://ghoulpool26.github.io'
    ].filter(x => x !== null).join('\n'),
    tags: ['skull'],
    priority: 4,
    click: death.source_url || 'https://ghoulpool26.github.io'
  });

  try {
    const res = await fetch('https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    console.log(`  📲 ntfy notification sent (${res.status})`);
  } catch (e) {
    console.error(`  ❌ ntfy send failed: ${e.message}`);
  }
}

// ── API call helper ─────────────────────────────────────────
async function callAPI(prompt, maxTokens = 4096, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (res.status === 429) {
        const waitMs = Math.pow(2, attempt + 1) * 30000;
        console.log(`  Rate limited. Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 400) {
          console.error(`  ❌ Non-retryable error ${res.status}: ${err.substring(0, 200)}`);
          return null;
        }
        throw new Error(`API error ${res.status}: ${err}`);
      }

      const data = await res.json();

      // Debug: log content blocks
      console.log(`  📋 Response blocks (${(data.content || []).length}):`);
      for (const block of (data.content || [])) {
        if (block.type === 'text') {
          console.log(`    [text] ${block.text.substring(0, 200)}${block.text.length > 200 ? '...' : ''}`);
        } else if (block.type === 'server_tool_use') {
          console.log(`    [search] ${JSON.stringify(block.input).substring(0, 150)}`);
        } else if (block.type === 'web_search_tool_result') {
          const title = block.content?.[0]?.title || '';
          console.log(`    [result] ${title.substring(0, 120)}`);
        }
      }

      return data;

    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      const waitMs = Math.pow(2, attempt + 1) * 15000;
      console.log(`  Error: ${e.message}. Retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }
  return null;
}

// ── Extract JSON array from response ────────────────────────
function extractJSON(data) {
  if (!data) return [];
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  console.log(`  🔍 Text: ${text.substring(0, 300)}${text.length > 300 ? '...' : ''}`);

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const result = JSON.parse(match[0]);
        console.log(`  🔧 JSON extracted via regex fallback`);
        return result;
      } catch {
        console.log(`  ❌ Both JSON parse and regex fallback failed`);
        return [];
      }
    }
    console.log(`  ❌ No JSON array found in response`);
    return [];
  }
}

// ── Stage 1: Batch scan (cheap, broad searches) ─────────────
async function scanBatch(batch) {
  const prompt = `Check if any of these people have died. Use a SMALL number of efficient web searches (at most 5). Search for "notable celebrity deaths 2025 2026" and Wikipedia death pages.

CRITICAL: ONLY report a death if you see the person's name EXPLICITLY in a search result as having died. If uncertain, do NOT include them. Return [] rather than guess.

Return ONLY a raw JSON array — no markdown, no explanation.
Format: [{"name":"Exact Name From List","year":YYYY,"date":"YYYY-MM-DD","source_name":"Outlet","source_url":"https://..."}]
If none died: []

People to check:
${batch.join('\n')}`;

  const data = await callAPI(prompt);
  return extractJSON(data);
}

// ── Stage 2: Verify a single death (targeted, per-name) ─────
async function verifySingleDeath(name) {
  console.log(`\n  🔎 Verifying: ${name}`);
  const prompt = `Search the web for "${name} death" and "${name} obituary". Has ${name} (the famous public figure) actually died?

RULES:
- Search at least 2 reputable sources (Wikipedia, BBC, CNN, Reuters, AP, NYT, etc.)
- If the person has died, return a JSON object: {"confirmed":true,"name":"${name}","year":YYYY,"date":"YYYY-MM-DD","source_name":"Outlet","source_url":"https://..."}
- If the person is alive or you cannot confirm death, return: {"confirmed":false}
- Return ONLY the JSON object, nothing else`;

  const data = await callAPI(prompt, 2048);
  if (!data) return null;

  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  console.log(`  🔎 Verification result: ${text.substring(0, 300)}`);

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const result = JSON.parse(match ? match[0] : clean);
    if (result.confirmed) {
      console.log(`  ✅ CONFIRMED: ${name} died ${result.date} (${result.source_name})`);
      return { name: result.name, year: result.year, date: result.date, source_name: result.source_name, source_url: result.source_url };
    } else {
      console.log(`  ❌ NOT CONFIRMED: ${name} is alive or unverifiable`);
      return null;
    }
  } catch (e) {
    console.log(`  ❌ Verification parse error: ${e.message}`);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  // Skip names already confirmed dead
  const aliveNames = uniqueNames.filter(n => !knownDeadNames.has(n));
  console.log(`${aliveNames.length} names to check (skipping ${knownDeadNames.size} known dead).`);

  const batches = chunk(aliveNames, BATCH_SIZE);
  const nameSetLower = new Set(uniqueNames.map(n => n.toLowerCase()));
  let candidates = [];

  // Stage 1: Cheap batch scans
  for (let i = 0; i < batches.length; i++) {
    console.log(`\nBatch ${i + 1}/${batches.length}: ${batches[i].join(', ')}`);
    const results = await scanBatch(batches[i]);
    const filtered = results.filter(d => nameSetLower.has(d.name.toLowerCase()));
    console.log(`  → ${filtered.length} candidate(s) found`);
    candidates = candidates.concat(filtered);

    if (i < batches.length - 1) {
      console.log('  Waiting 15s before next batch...');
      await sleep(15000);
    }
  }

  // Stage 2: Individually verify each candidate
  let verifiedDeaths = [];
  if (candidates.length > 0) {
    console.log(`\n══ Stage 2: Verifying ${candidates.length} candidate(s) ══`);

    // Deduplicate candidates by name
    const seen = new Set();
    const uniqueCandidates = candidates.filter(d => {
      const lower = d.name.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });

    for (const candidate of uniqueCandidates) {
      // Skip if already in our records
      if (knownDeadNames.has(candidate.name)) {
        console.log(`  Skipping ${candidate.name} — already recorded.`);
        continue;
      }

      await sleep(5000); // brief pause before verification call
      const verified = await verifySingleDeath(candidate.name);
      if (verified) {
        verifiedDeaths.push(verified);
      }
    }
  }

  // Notify for new verified deaths
  if (verifiedDeaths.length > 0) {
    console.log(`\n🔔 ${verifiedDeaths.length} VERIFIED new death(s)!`);
    for (const death of verifiedDeaths) {
      console.log(`  💀 ${death.name} (${death.date}) — ${death.source_name}`);
      await sendNtfyAlert(death);
    }
  } else {
    console.log('\nNo new deaths confirmed.');
  }

  // Append only verified deaths to existing list
  const mergedDeaths = [...existingDeaths, ...verifiedDeaths];
  const output = { deaths: mergedDeaths, updated: new Date().toISOString() };
  fs.writeFileSync('deaths.json', JSON.stringify(output, null, 2));
  console.log(`\n✅ Done. ${mergedDeaths.length} total deaths in deaths.json (${verifiedDeaths.length} new).`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
