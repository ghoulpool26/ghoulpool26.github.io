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
const BATCH_SIZE = 25;

// ── Load previous deaths so we can detect NEW ones ──────────
let existingDeaths = [];
let previousDeadNames = new Set();
try {
  const prev = JSON.parse(fs.readFileSync('deaths.json', 'utf8'));
  existingDeaths = prev.deaths || [];
  existingDeaths.forEach(d => previousDeadNames.add(d.name));
  console.log(`Loaded ${previousDeadNames.size} previously known death(s).`);
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

// ── Anthropic batch check (unchanged) ───────────────────────
async function checkBatchWithRetry(batch, maxRetries = 5) {
  const prompt = `Check if any of these people have died. Use a SMALL number of efficient web searches — do NOT search for each person individually. Instead:
1. Search "notable celebrity deaths 2025 2026" and similar broad queries
2. Search Wikipedia's "Deaths in 2025" and "Deaths in 2026" pages
3. Only do individual searches for people you find mentioned in death-related results

Use AT MOST 5 web searches total for this entire list.

CRITICAL ACCURACY RULES:
- ONLY report a death if you see the person's name EXPLICITLY mentioned in a search result snippet as having died
- Do NOT guess or infer deaths — if you don't see clear confirmation, do NOT include them
- If you are uncertain about ANYONE, leave them OUT of the results
- It is much better to return [] than to include an unverified death
- Only return names from my list below, copied EXACTLY as written
- Include deaths from any year (2024, 2025, 2026, etc.)
- Return ONLY a raw JSON array — no markdown, no explanation, no preamble
- If none have died, return exactly: []

Format: [{"name":"Exact Name From List","year":YYYY,"date":"YYYY-MM-DD","source_name":"Outlet Name","source_url":"https://..."}]

People to check:
${batch.join('\n')}`;

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
          max_tokens: 4096,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (res.status === 429) {
        const waitMs = Math.pow(2, attempt + 1) * 30000;
        console.log(`  Rate limited. Waiting ${waitMs/1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        // Don't retry 400 errors (prompt too long, bad request) — they'll never succeed
        if (res.status === 400) {
          console.error(`  ❌ Non-retryable error ${res.status}: ${err.substring(0, 200)}`);
          return [];
        }
        throw new Error(`API error ${res.status}: ${err}`);
      }

      const data = await res.json();

      // ── Debug: log every content block ──────────────────
      console.log(`  📋 Response blocks (${(data.content || []).length}):`);
      for (const block of (data.content || [])) {
        if (block.type === 'text') {
          console.log(`    [text] ${block.text.substring(0, 300)}${block.text.length > 300 ? '...' : ''}`);
        } else if (block.type === 'tool_use') {
          console.log(`    [tool_use] ${block.name} → ${JSON.stringify(block.input).substring(0, 200)}`);
        } else if (block.type === 'tool_result') {
          const preview = JSON.stringify(block.content).substring(0, 300);
          console.log(`    [tool_result] ${preview}${JSON.stringify(block.content).length > 300 ? '...' : ''}`);
        } else {
          console.log(`    [${block.type}] ${JSON.stringify(block).substring(0, 200)}`);
        }
      }

      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      console.log(`  🔍 Final text output: ${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`);

      let deaths = [];
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        deaths = JSON.parse(clean);
      } catch (e) {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            deaths = JSON.parse(match[0]);
            console.log(`  🔧 JSON extracted via regex fallback`);
          } catch(e2) {
            console.log(`  ❌ Both JSON parse and regex fallback failed`);
            console.log(`  Raw text: ${text.substring(0, 500)}`);
            deaths = [];
          }
        } else {
          console.log(`  ❌ No JSON array found in response`);
          console.log(`  Raw text: ${text.substring(0, 500)}`);
        }
      }

      console.log(`  ✅ Parsed ${deaths.length} death(s) from this batch`);

      // Hallucination check: if 3+ deaths share the exact same date, reject all
      if (deaths.length >= 3) {
        const dateCounts = {};
        deaths.forEach(d => { dateCounts[d.date] = (dateCounts[d.date] || 0) + 1; });
        const maxSameDate = Math.max(...Object.values(dateCounts));
        if (maxSameDate >= 3) {
          console.log(`  🚫 Hallucination detected: ${maxSameDate} deaths on same date. Discarding batch.`);
          return [];
        }
      }

      return deaths;

    } catch(e) {
      if (attempt === maxRetries - 1) throw e;
      const waitMs = Math.pow(2, attempt + 1) * 15000;
      console.log(`  Error: ${e.message}. Retrying in ${waitMs/1000}s...`);
      await sleep(waitMs);
    }
  }
  return [];
}

// ── Main ────────────────────────────────────────────────────
async function fetchDeaths() {
  // Skip names already confirmed dead
  const aliveNames = uniqueNames.filter(n => !previousDeadNames.has(n));
  console.log(`${aliveNames.length} names to check (skipping ${previousDeadNames.size} known dead).`);

  const batches = chunk(aliveNames, BATCH_SIZE);
  const nameSetLower = new Set(uniqueNames.map(n => n.toLowerCase()));
  let allDeaths = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`\nBatch ${i + 1}/${batches.length}: ${batches[i].join(', ')}`);
    const results = await checkBatchWithRetry(batches[i]);
    const filtered = results.filter(d => nameSetLower.has(d.name.toLowerCase()));
    console.log(`  → ${filtered.length} deaths found`);
    filtered.forEach(d => console.log(`     💀 ${d.name} (${d.date}) — ${d.source_name}`));
    allDeaths = allDeaths.concat(filtered);

    if (i < batches.length - 1) {
      console.log('  Waiting 15s before next batch...');
      await sleep(15000);
    }
  }

  return allDeaths;
}

fetchDeaths()
  .then(async runDeaths => {
    // ── Merge: add only NEW deaths to the existing list ───
    const newDeaths = runDeaths.filter(d => !previousDeadNames.has(d.name));

    if (newDeaths.length > 0) {
      console.log(`\n🔔 ${newDeaths.length} NEW death(s) detected — sending notifications...`);
      for (const death of newDeaths) {
        console.log(`  → Notifying: ${death.name}`);
        await sendNtfyAlert(death);
      }
    } else {
      console.log('\nNo new deaths since last run.');
    }

    // Append new deaths to existing list (never overwrite)
    const mergedDeaths = [...existingDeaths, ...newDeaths];
    const output = { deaths: mergedDeaths, updated: new Date().toISOString() };
    fs.writeFileSync('deaths.json', JSON.stringify(output, null, 2));
    console.log(`\n✅ Done. ${mergedDeaths.length} total deaths in deaths.json (${newDeaths.length} new).`);
  })
  .catch(err => {
    console.error('Failed:', err.message);
    // On error, don't touch deaths.json — preserve existing data
    process.exit(1);
  });
