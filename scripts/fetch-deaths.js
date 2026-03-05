const fs = require('fs');

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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkBatch(batch) {
  const prompt = `I am going to give you a list of names. For each person who has died, search the web to find and verify their death.

CRITICAL RULES:
- Only return names from my list below, copied exactly as written
- Do NOT add any names not on my list
- Only include confirmed deaths — you must visit a reputable news source (BBC, CNN, Reuters, AP, NPR, NYT, Washington Post, etc.) to verify
- Return ONLY a JSON array, no markdown, no explanation
- If none have died, return: []

For each confirmed death return this exact format:
{"name":"Exact Name From List","year":2026,"date":"YYYY-MM-DD","source_name":"Outlet Name","source_url":"https://..."}

List:
${batch.join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let deaths = [];
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    deaths = JSON.parse(clean);
  } catch (e) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try { deaths = JSON.parse(match[0]); } catch(e2) { deaths = []; }
    }
  }

  return deaths;
}

async function fetchDeaths() {
  const batches = chunk(uniqueNames, BATCH_SIZE);
  const nameSetLower = new Set(uniqueNames.map(n => n.toLowerCase()));
  let allDeaths = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`Checking batch ${i + 1}/${batches.length}: ${batches[i].join(', ')}`);
    const results = await checkBatch(batches[i]);
    // Safety filter
    const filtered = results.filter(d => nameSetLower.has(d.name.toLowerCase()));
    console.log(`  → ${filtered.length} deaths found in this batch`);
    allDeaths = allDeaths.concat(filtered);
    // Wait 65s between batches to ensure the rate limit window resets
    if (i < batches.length - 1) {
      console.log('  Waiting 65s before next batch...');
      await sleep(65000);
    }
  }

  return { deaths: allDeaths, updated: new Date().toISOString() };
}

fetchDeaths()
  .then(result => {
    fs.writeFileSync('deaths.json', JSON.stringify(result, null, 2));
    console.log(`\nDone. Found ${result.deaths.length} total deaths.`);
    result.deaths.forEach(d => console.log(` - ${d.name} (${d.date}) — ${d.source_name}: ${d.source_url}`));
  })
  .catch(err => {
    console.error('Failed:', err.message);
    if (!fs.existsSync('deaths.json')) {
      fs.writeFileSync('deaths.json', JSON.stringify({ deaths: [], updated: new Date().toISOString() }, null, 2));
    }
    process.exit(1);
  });
