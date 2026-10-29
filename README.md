# Kodekirkegården 🪦

![Megakart over oppgaven](kart.jpg)

Lag en agent som graver i et hjemsøkt repo, finner død kode og skriver nekrolog over det som trygt kan begraves.

## Kom i gang

```bash
npm install
cp .env .env        # lim inn API-nøkkelen fra Hekserådet
npm start                   # kjører eksempeloppgaven
npm start -- "Hvilke pakker i package.json brukes ikke?"
```

Agenten har bare ett verktøy fra start (`sok_i_repo`). Resten er deres jobb.

## Hva ligger her

```
src/
  index.js        startpunkt, leser spørsmålet fra kommandolinja
  agent.js        agentløkka: spør modellen, kjør verktøy, gjenta
  verktoy.js      systemprompt, eksempeloppgave og verktøyene
hjemsokt-repo/    en intern bookingtjeneste med mye gammelt rusk
data/
  git-logg.json   commit-historikk per fil (dato, forfatter, melding)
```

Ikke kjør `npm install` inne i `hjemsokt-repo`. Det er et lik, ikke et prosjekt.

## Legg til et verktøy

I `src/verktoy.js` ligger `les_fil`, `finn_referanser` og `hent_git_historikk` som stubber med `kjør: null`. De sendes ikke til modellen før de har en `kjør`-funksjon. Gi dem en, så er de med:

```js
// les_fil
kjør: async ({ fil }) => {
  const full = path.join(REPO, fil);
  if (!full.startsWith(REPO)) throw new Error('Fila må ligge i hjemsokt-repo');
  return fs.readFileSync(full, 'utf8')
    .split('\n')
    .map((linje, i) => `${i + 1}: ${linje}`)
    .join('\n');
},
```

Kaster funksjonen en feil, får modellen feilmeldingen tilbake og kan prøve igjen. Beskrivelsen i `definisjon` er det modellen leser for å skjønne når verktøyet skal brukes, så skriv den som til en ny kollega.

## Hvis du ikke bruker JavaScript

Dataene er vanlige filer: `hjemsokt-repo/` er bare tekst, og `data/git-logg.json` er ren JSON. Bruk dem fra Python, Kotlin eller hva dere vil. Agentløkka i `src/agent.js` er rundt 80 linjer og lett å skrive om.

## Tips

- MVP er to verktøy og én løkke. Få `les_fil` på plass før dere bygger noe mer.
- Vis verktøykallene i demoen. Det er de som viser at agenten faktisk jobber selv.
- `MAX_ITERASJONER` i `.env` stopper en agent som går i ring. Standard er 10.
- `.env` committes aldri. Den står allerede i `.gitignore`.

## Web-visning (backend + animasjon)

```bash
npm install
cp .env.example .env     # lim inn ANTHROPIC_API_KEY (valgfritt for demo-modus)
npm run web              # http://127.0.0.1:3000
```

`server.js` serverer `public/index.html` og streamer agentens arbeid som Server-Sent Events
(`/api/run?modus=live|demo`). Hver fil i `hjemsokt-repo/` tegnes som en gravstein, og agenten går
til filene den leser. Agenten leverer funn med verktøyet `registrer_funn`, og frontend begraver
eller lar stå. Demo-modus spiller av et manus uten AI (verktøyene kjører likevel mot ekte kode).
`npm start` kjører fortsatt agenten i terminalen som før.

## Web-visning (backend + animasjon)

```bash
npm install
cp .env .env     # lim inn ANTHROPIC_API_KEY (valgfritt for demo-modus)
npm run web              # http://127.0.0.1:3000
```

`server.js` serverer `public/index.html` og streamer agentens arbeid som Server-Sent Events
(`/api/run?modus=live|demo`). Hver fil i `hjemsokt-repo/` tegnes som en gravstein, og agenten går
til filene den leser. Agenten leverer funn med verktøyet `registrer_funn`, og frontend begraver
eller lar stå. Demo-modus spiller av et manus uten AI (verktøyene kjører likevel mot ekte kode).
`npm start` kjører fortsatt agenten i terminalen som før.
