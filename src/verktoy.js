// Verktøyene agenten kan bruke. Et verktøy er en definisjon (det modellen ser)
// og en kjør-funksjon (det som faktisk skjer). kjør: null betyr stub: den
// sendes ikke til modellen før dere har implementert den.
import fs from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(import.meta.dirname, '../hjemsokt-repo');
export const GIT_LOGG = path.resolve(import.meta.dirname, '../data/git-logg.json');

export const system = `Du er graver på kodekirkegården. Du leter etter død kode i repoet hjemsokt-repo:
funksjoner ingen kaller, pakker ingen importerer, utkommentert kode, gamle TODO-er,
tester som alltid skippes og feature-flagg som aldri endres.
Undersøk før du konkluderer: finn noe mistenkelig, sjekk om noe bruker det, og gå videre.
For hvert funn skriver du en kort nekrolog: hva det var, når det sist ble rørt, og hvorfor
det trygt kan begraves. Si tydelig fra når du er usikker, og si hva som IKKE bør fjernes.
Svar på norsk.`;

export const eksempelOppgave = 'Finn død kode i hjemsokt-repo og skriv en nekrolog for det tryggeste funnet.';

const MAKS_TREFF = 50;

function alleFiler(mappe) {
  return fs.readdirSync(mappe, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name === '.git') return [];
    const full = path.join(mappe, d.name);
    return d.isDirectory() ? alleFiler(full) : [full];
  });
}

function sokIRepo({ monster, regex = false, maks_treff = MAKS_TREFF } = {}) {
  if (typeof monster !== 'string' || !monster.trim()) {
    throw new Error('Mangler «monster». Send f.eks. {"monster": "TODO"} eller {"monster": "require\\\\(", "regex": true}.');
  }
  let test;
  if (regex) {
    let re;
    try {
      re = new RegExp(monster, 'i');
    } catch (e) {
      throw new Error(`Ugyldig regex «${monster}»: ${e.message}`);
    }
    test = (linje) => re.test(linje);
  } else {
    const nål = monster.toLowerCase();
    test = (linje) => linje.toLowerCase().includes(nål);
  }

  const grense = Math.min(Math.max(1, Number(maks_treff) || MAKS_TREFF), 200);
  const { treff, totalt } = skann(test, grense);

  if (totalt === 0) return `Ingen treff på «${monster}».`;
  return formater(treff, totalt);
}

// Går gjennom alle linjer i repoet og samler de som test() godtar.
function skann(test, grense) {
  const treff = [];
  let totalt = 0;
  for (const fil of alleFiler(REPO)) {
    const linjer = fs.readFileSync(fil, 'utf8').split('\n');
    linjer.forEach((linje, i) => {
      if (!test(linje)) return;
      totalt++;
      if (treff.length < grense) treff.push(`${path.relative(REPO, fil)}:${i + 1}: ${linje.trim()}`);
    });
  }
  return { treff, totalt };
}

function formater(treff, totalt) {
  const hale = totalt > treff.length ? `\n… ${totalt - treff.length} treff til. Snevre inn søket.` : '';
  return treff.join('\n') + hale;
}

// Gjør om en sti fra modellen til en absolutt sti som garantert ligger i REPO.
function repoSti(fil) {
  if (typeof fil !== 'string' || !fil.trim()) {
    throw new Error('Mangler «fil». Send f.eks. {"fil": "src/server.js"}.');
  }
  const full = path.resolve(REPO, fil);
  const rel = path.relative(REPO, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Fila må ligge i hjemsokt-repo.');
  return full;
}

function lesFil({ fil } = {}) {
  const full = repoSti(fil);
  if (!fs.existsSync(full)) {
    throw new Error(`Fant ikke «${fil}». Stien må være relativ til roten av hjemsokt-repo. Bruk sok_i_repo for å finne riktig sti.`);
  }
  if (!fs.statSync(full).isFile()) {
    const innhold = fs.readdirSync(full).join(', ');
    throw new Error(`«${fil}» er en mappe, ikke en fil. Innhold: ${innhold}`);
  }
  return fs.readFileSync(full, 'utf8')
    .split('\n')
    .map((linje, i) => `${i + 1}: ${linje}`)
    .join('\n');
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function finnReferanser({ navn } = {}) {
  if (typeof navn !== 'string' || !navn.trim()) {
    throw new Error('Mangler «navn». Send f.eks. {"navn": "beregnRabatt"}.');
  }
  const n = escapeRegex(navn.trim());
  // Hele ord, men uten \b: navn som «@scope/pakke» starter ikke på et ordtegn.
  const bruk = new RegExp(`(?<![\\w$])${n}(?![\\w$])`);
  const definisjon = new RegExp(
    `\\b(function\\*?|class|const|let|var)\\s+${n}(?![\\w$])` + // function navn, const navn =
    `|^\\s*(async\\s+)?${n}\\s*\\([^)]*\\)\\s*\\{` + // metode: navn(...) {
    `|^\\s*"${n}"\\s*:`, // "navn": i package.json
  );
  const test = (linje) => bruk.test(linje) && !definisjon.test(linje);

  const { treff, totalt } = skann(test, MAKS_TREFF);
  if (totalt === 0) {
    return `Ingen referanser til «${navn}» utenom definisjonen. Sjekk likevel indirekte bruk ` +
      '(strenger i config, dynamisk import, npm-scripts) med sok_i_repo før du konkluderer.';
  }
  return formater(treff, totalt);
}

function hentGitHistorikk({ fil } = {}) {
  repoSti(fil); // samme sti-validering som les_fil
  const logg = JSON.parse(fs.readFileSync(GIT_LOGG, 'utf8')).filer;
  const nøkkel = path.relative(REPO, path.resolve(REPO, fil)).split(path.sep).join('/');
  const commits = logg[nøkkel];
  if (!commits) {
    const navnet = path.basename(nøkkel);
    const lignende = Object.keys(logg).filter((f) => path.basename(f) === navnet || f.includes(navnet));
    const tips = lignende.length ? ` Mente du: ${lignende.join(', ')}?` : ` Filer i loggen: ${Object.keys(logg).join(', ')}`;
    throw new Error(`Ingen git-historikk for «${fil}».${tips}`);
  }
  return [...commits]
    .sort((a, b) => b.dato.localeCompare(a.dato))
    .map((c) => `${c.dato} ${c.hash} ${c.forfatter}: ${c.melding}`)
    .join('\n');
}

export const verktøy = [
  {
    definisjon: {
      name: 'sok_i_repo',
      description:
        'Søker gjennom alle filene i hjemsokt-repo (kode, tester, config, package.json) og returnerer ' +
        'treff som «fil:linje: tekst». Bruk det for å finne hvor noe er definert eller brukt, f.eks. et ' +
        'funksjonsnavn, et pakkenavn, "TODO", "it.skip" eller "featureFlags". Vanlig tekstsøk uten ' +
        'hensyn til store og små bokstaver. Sett regex: true for regulære uttrykk. Gir maks 50 treff ' +
        'som standard, så søk smalt hvis du får for mange.',
      input_schema: {
        type: 'object',
        properties: {
          monster: { type: 'string', description: 'Teksten eller regexen du søker etter.' },
          regex: { type: 'boolean', description: 'Tolk monster som regulært uttrykk. Standard false.' },
          maks_treff: { type: 'number', description: 'Maks antall treff (1–200). Standard 50.' },
        },
        required: ['monster'],
      },
    },
    kjør: async (input) => sokIRepo(input),
  },
  {
    definisjon: {
      name: 'les_fil',
      description:
        'Leser innholdet i én fil i hjemsokt-repo, med linjenumre. Oppgi stien relativt til roten av ' +
        'repoet, f.eks. "src/services/bookingService.js". Bruk det når et søketreff ser mistenkelig ut ' +
        'og du trenger å se sammenhengen rundt.',
      input_schema: {
        type: 'object',
        properties: {
          fil: { type: 'string', description: 'Sti relativt til hjemsokt-repo.' },
        },
        required: ['fil'],
      },
    },
    kjør: async (input) => lesFil(input),
  },
  {
    definisjon: {
      name: 'finn_referanser',
      description:
        'Finner alle steder et navn (funksjon, variabel, pakke eller fil) brukes i hjemsokt-repo, ' +
        'utenom der det er definert. Svarer med en liste over filer og linjer, og sier tydelig fra hvis ' +
        'det ikke finnes noen. Husk at kode kan brukes indirekte: via strenger i config, dynamisk ' +
        'import, npm-scripts eller fra andre repoer. Null treff betyr ikke alltid at noe er dødt.',
      input_schema: {
        type: 'object',
        properties: {
          navn: { type: 'string', description: 'Navnet du vil finne bruk av, f.eks. "beregnRabatt" eller "moment".' },
        },
        required: ['navn'],
      },
    },
    kjør: async (input) => finnReferanser(input),
  },
  {
    definisjon: {
      name: 'hent_git_historikk',
      description:
        'Henter commit-historikken for én fil i hjemsokt-repo: dato, forfatter og melding, nyeste først. ' +
        'Bruk det for å si når noe sist ble rørt og av hvem, f.eks. «sist endret av Mona i 2021».',
      input_schema: {
        type: 'object',
        properties: {
          fil: { type: 'string', description: 'Sti relativt til hjemsokt-repo, f.eks. "src/utils/legacyCsv.js".' },
        },
        required: ['fil'],
      },
    },
    kjør: async (input) => hentGitHistorikk(input),
  },
];
