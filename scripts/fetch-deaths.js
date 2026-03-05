const fs = require('fs');

const allNames = [
  "Robert Redford","Chuck Grassley","Lou Holtz","Deion Sanders","Ariana Grande","Paul Pelosi","Bryan Johnson","Mel Brooks","Ric Flair","Clint Eastwood","Virginia Foxx","Robert Plant","Willie Nelson","Rudy Giuliani","Kanye West","Mitch McConnell","Joe Namath","Antonio Brown","Donald Trump","Phil Knight","Dick Van Dyke","Clarence Thomas","Bernie Kosar","Julie Andrews","Dolly Parton",
  "Harvey Weinstein","King Charles","Katy Perry","Guy Fieri","Phil Mickelson","Bill Belichick","Andrew Windsor","Danny DeVito","John Kerry","Jax Taylor","Jim Carrey","George W Bush","George Strait","Nancy Pelosi","Steve Spurrier","Corey Feldman","Bill Clinton","Flavor Flav","Bruce Willis","RFK","Stephen Fry",
  "Sandy Koufax","Liver King","Ian Michelin","Harrison Ford","Buzz Aldrin","Anthony Hopkins","John Daly","Joe Biden","Salman Rushdie","Alex Murdoch","David Attenborough","Netanyahu","Kevin Spacey","Yoko Ono","Michael Caine","Patrick Stewart",
  "Caitlyn Jenner","Amanda Bynes","Jerry Sandusky","Bill Cosby","Dennis Rodman","Bam Margera","Elton John","Michael J Fox","Ghislaine Maxwell","Wendi Adelson","P Diddy","Britney Spears","Charlie Sheen","Macaulay Culkin","Demi Lovato","Casey Anthony",
  "King Salman","Vladimir Putin","Bob Iger","Warren Buffett","Dan Rather","Raul Castro","Dick Greco","Joe Namath","Andrea Mitchell","Alan Greenspan","William Shatner","Richard Shelby","Yoko Ono",
  "Wendy Williams","Naomi Campbell","Pete Doherty","Elon Musk","Carol Burnett","King Charles III","Eric Clapton","Will Smith","Woody Allen","Steven Tyler","Julie Andrews","Keith Richards","John Mulaney","Queen Camilla","Iggy Pop",
  "Pat Ryan","Burt Kreischer","John Frusciante","Jerry Jones","Jelly Roll","Morgan Freeman","MGK","John Mulaney","Miley Cyrus","Johnny Manziel","John Daly","Antonio Brown",
  "Jack Nicklaus","Ayatollah Khamenei","Rudy Giuliani","Lee Corso","Arthur Blank","Paul McCartney","Dick Vitale","Terry Bradshaw","Ellen DeGeneres","John Thune","Joe Pesci","Mack Brown","Jerry Jones"
];

// Deduplicate
const names = [...new Set(allNames)];

async function fetchDeaths() {
  const prompt = `Search the web and identify which of these people have died. Only confirmed deaths. Today is 2026. Return ONLY a valid JSON array, no markdown, no explanation. Format: [{"name":"Exact Name As Given","year":2026}]. If none have died return [].

Names: ${names.join(', ')}`;

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
    if (match) deaths = JSON.parse(match[0]);
  }

  return { deaths, updated: new Date().toISOString() };
}

fetchDeaths()
  .then(result => {
    fs.writeFileSync('deaths.json', JSON.stringify(result, null, 2));
    console.log(`Done. Found ${result.deaths.length} deaths.`);
    result.deaths.forEach(d => console.log(` - ${d.name} (${d.year})`));
  })
  .catch(err => {
    console.error('Failed:', err.message);
    // Write empty file so the site still loads
    if (!fs.existsSync('deaths.json')) {
      fs.writeFileSync('deaths.json', JSON.stringify({ deaths: [], updated: new Date().toISOString() }, null, 2));
    }
    process.exit(1);
  });
