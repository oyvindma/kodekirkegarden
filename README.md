# Kodekirkegården 🪦

![Megakart over oppgaven](kart.jpg)

Lag en agent som graver i et hjemsøkt repo, finner død kode og skriver nekrolog over det som trygt kan begraves.

## Kom i gang

```bash
npm install
# lag .env med ANTHROPIC_API_KEY=<nøkkelen fra Hekserådet>
npm start                   # kjører eksempeloppgaven
npm start -- "Hvilke pakker i package.json brukes ikke?"
```

Agenten har nå fem verktøy (`sok_i_repo`, `les_fil`, `finn_referanser`, `hent_git_historikk`, `registrer_funn`).

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

## Web-visning

```bash
npm install
# lag .env med ANTHROPIC_API_KEY=<din nøkkel>   (valgfritt: uten den virker bare demo-modus)
npm run web              # http://127.0.0.1:3000   (PORT=3003 npm run web for annen port)
```

`npm start` kjører fortsatt samme agent i terminalen. `npm run web` viser den som en animasjon.

## Arkitektur

### 1. Oversikt

```
┌──────────────────────── Nettleser (public/index.html) ───────────────────────┐
│  Canvas: kirkegård (1 gravstein = 1 fil)        Sidepanel: logg, siste svar  │
│        ▲                                                  ▲                  │
│        │ tegnes av                                        │                  │
│  ┌─────┴──────────────── Hendelseskø (queue) ─────────────┴──────┐           │
│  │ én hendelse om gangen: animer ferdig → vis → neste            │           │
│  └───────────────────────────────▲───────────────────────────────┘           │
│                                  │ EventSource (SSE)                         │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │  GET /api/run?modus=live|demo
┌──────────────────────────────────┼───────────────── Node (server.js) ────────┐
│  /api/status  /api/repo  statiske filer                                      │
│                                  │ emit(hendelse) → «data: {...}\n\n»        │
│                        ┌─────────┴──────────┐                                │
│                        │  agent.js          │  agentløkka (kjørAgent)        │
│                        └───┬────────────┬───┘                                │
│                  modell()  │            │  kjør()                            │
│          ┌─────────────────▼───┐   ┌────▼───────────────────────────┐        │
│          │ live: Claude API    │   │ verktoy.js                     │        │
│          │ demo: demo.js       │   │  sok_i_repo   les_fil          │        │
│          │       (manus, ikke  │   │  finn_referanser               │        │
│          │        AI)          │   │  hent_git_historikk            │        │
│          └─────────────────────┘   │  registrer_funn                │        │
│                                    └───────┬────────────────────────┘        │
└────────────────────────────────────────────┼─────────────────────────────────┘
                                             ▼
                          hjemsokt-repo/ (kode)   data/git-logg.json (historikk)
```

Modellen får aldri tilgang til disk selv. Den kan bare be om verktøy, og `verktoy.js` er det eneste som leser filer.

### 2. Filkart

```
server.js            HTTP-server (node:http, ingen avhengigheter): API + statiske filer + SSE
src/agent.js         agentløkka. Sender hendelser til emit(). Kjenner ikke HTTP.
src/verktoy.js       systemprompt, oppgave, de 5 verktøyene, repoFiler()
src/demo.js          «falsk modell» som spiller av et manus (ingen AI, ingen nøkkel)
src/demo-funn.json   manuset: de 13 funnene demoen leverer
src/index.js         CLI-inngang (npm start): samme agent, hendelser skrives til terminalen
public/index.html    hele frontend: canvas-animasjon, kø, panel (ingen byggesteg)
hjemsokt-repo/       koden agenten undersøker (det «hjemsøkte» repoet)
data/git-logg.json   commit-historikk per fil
```

### 3. Agentløkka (`src/agent.js`)

Hele «agent-greia» er en løkke: spør modellen, kjør verktøyene den ber om, send resultatene
tilbake, gjenta til modellen svarer uten å be om verktøy.

```
                       kjørAgent({ system, oppgave, verktøy, modell, emit, signal })
                                        │
                         messages = [ {role:user, content: oppgave} ]
                                        │
              ┌─────────────────────────▼──────────────────────────┐
              │  for i = 1 … MAX_ITERASJONER (standard 40)         │
              │                                                    │
              │  signal.aborted? ──ja──► return (nettleser lukket) │
              │            │nei                                    │
              │            ▼                                       │
              │  svar = await modell({system, tools, messages})    │◄── Claude API
              │  messages.push(assistant: svar.content)            │    (eller demo.js)
              │            │                                       │
              │   stop_reason == "tool_use" ?                      │
              │      │ nei                      │ ja               │
              │      ▼                          ▼                  │
              │  emit(ferdig) ──► return   emit(tanke)  ← tekst    │
              │  (end_turn | refusal |     for hvert tool_use:     │
              │   max_tokens)                emit(kall)            │
              │                              resultat = kjør(...)  │──► verktoy.js
              │                              emit(svar)            │
              │                              hvis registrer_funn   │
              │                                og ok: emit(funn)   │
              │                            messages.push(user:     │
              │                               alle tool_result)     │
              └───────────────────┬────────────────────────────────┘
                                  │ (neste runde)
                                  ▼
            etter siste runde uten end_turn: emit(ferdig, stopp:"maks_iterasjoner")
```

Viktige regler i løkka:

- **Alle** `tool_result` fra én runde sendes tilbake i **én** melding, også når modellen ba om flere verktøy samtidig.
- Kaster et verktøy en feil, går feilmeldingen tilbake til modellen som `tool_result` med `is_error: true`, og modellen kan prøve igjen (f.eks. feil filsti).
- `MAX_ITERASJONER` (env, standard 40) stopper en agent som går i ring, og begrenser kostnaden.
- `registrer_funn` er agentens «leveranse»: den må velge `dom: "begrav"` eller `"la_staa"` og skrive nekrolog + begrunnelse. Det er dette frontend viser som begravelse eller lykt.
- `anthropicModell()` laster SDK-et først i live-modus (`await import`), så demo virker uten installerte pakker.

### 4. API og hendelsesprotokoll

| Endepunkt | Gjør |
|---|---|
| `GET /` | `public/index.html` |
| `GET /api/status` | `{ harNokkel, modell, maksIterasjoner, oppgave }`. Frontend bruker det til å slå av live-knappen uten nøkkel |
| `GET /api/repo` | `{ navn, filer: [{ fil, linjer }] }`. Frontend bygger kirkegården av de faktiske filene |
| `GET /api/run?modus=live\|demo&oppgave=…` | Server-Sent Events: én kjøring, strømmer hendelser |

Hendelsene (hver er én `data: {json}`-linje):

```
start    { modus, modell, oppgave, maks }
tanke    { tekst }                               modellens tekst mellom verktøykall
kall     { id, navn, input }                     agenten BER om et verktøy
svar     { id, navn, tekst, feil, filer[] }      verktøyets resultat (tekst kuttet ved 2500 tegn)
                                                 filer[] = filer som fikk søketreff («fil:linje:»)
funn     { fil, tittel, dom, nekrolog, begrunnelse }
ferdig   { stopp, iterasjoner, funn, sammendrag, advarsel }   siste hendelse
feil     { melding }                             uventet feil (API-feil, manglende nøkkel …)
```

Typisk strøm for ett funn:

```
 tanke  "Mistenkelig: legacyCsv.js …"
 kall   sok_i_repo        → svar (treff + filer[])
 kall   les_fil           → svar
 kall   finn_referanser   → svar
 kall   hent_git_historikk→ svar
 kall   registrer_funn    → svar → funn { dom: "begrav", nekrolog … }
```

### 5. Sekvens: fra klikk til animasjon

```
 Nettleser                       server.js                    agent.js / verktøy     Claude
    │  GET /api/status, /api/repo    │                              │                   │
    │ ─────────────────────────────► │                              │                   │
    │  ◄── JSON (bygger kirkegård)   │                              │                   │
    │                                │                              │                   │
    │  [Start]  new EventSource      │                              │                   │
    │  GET /api/run?modus=live       │                              │                   │
    │ ─────────────────────────────► │  lås (én kjøring om gangen)  │                   │
    │                                │  kjørAgent(emit, signal) ──► │                   │
    │  ◄── data: start               │                              │ messages.create ► │
    │                                │                              │ ◄── tool_use      │
    │  ◄── data: kall                │ ◄── emit ─────────────────── │                   │
    │  ◄── data: svar                │ ◄── emit ─── kjør() ───────► (leser disk)        │
    │  ◄── data: funn …              │                              │ …gjentas…         │
    │  ◄── data: ferdig              │ ◄── emit ─────────────────── │ ◄── end_turn      │
    │                                │  res.end(), slipp låsen      │                   │
    │  lukker EventSource            │                              │                   │
    │                                │                              │                   │
    │  [Stopp / lukk fane]           │                              │                   │
    │ ───────── tilkobling lukkes ─► │  res.on('close') → abort() ─►│ signal.aborted ✓  │
    │                                │                              │ (stopper kallene) │
```

### 6. Synk mellom backend og frontend

Backend og animasjon går **ikke** i takt. Agenten kan levere verktøysvar på millisekunder, mens
det tar sekunder å gå over kirkegården. Derfor kjører frontend en **hendelseskø**:

```
  SSE onmessage ──► queue.push(hendelse)          (backend går i sitt eget tempo)
                          │
                          ▼
            ┌──────────────────────────┐
            │ cur == null og kø ikke   │
            │ tom?  → begin(queue[0])  │
            └────────────┬─────────────┘
                         ▼
     ┌───────────── cur.stage ─────────────┐
     │   "walk"  agenten går til graven    │  kall / funn med fil
     │      │ fremme (< 5 px)              │
     │      ▼                              │
     │   arrived()  bruk funnet på graven  │  kun for «funn»
     │      ▼                              │
     │   "dwell" vent cur.time sekunder    │  alle typer
     │      │ tiden ute                    │
     │      ▼                              │
     │   end()  → cur = null → neste       │
     └─────────────────────────────────────┘
```

| Hendelse | Hva animasjonen gjør | Ca. varighet (×1) |
|---|---|---|
| `tanke` | taleboble over agenten, linje i loggen | 1,1–3 s etter tekstlengde |
| `kall` med `fil` (`les_fil`, `hent_git_historikk`, `registrer_funn`) | agenten **går** til gravsteinen | gange + 0,5 s |
| `kall` uten `fil` (`sok_i_repo`, `finn_referanser`) | ring-puls rundt agenten | 0,5 s |
| `svar` | resultat i sidepanelet; filene i `filer[]` **lyser opp** | 0,8–1,2 s |
| `funn` | agenten går til steinen: `begrav` = gravhaug, `la_staa` = grønn lykt, nekrolog i panelet | gange + 1,8 s |
| `ferdig` / `feil` | obduksjonsrapport over kirkegården | 1,2 s |

Konsekvenser:

- **Rekkefølgen er garantert** (køen er FIFO), og tellerne i panelet følger animasjonen, ikke nettverket.
- Fart ×1/×2/×4 kjører `update()` flere ganger per bilde. Pause fryser animasjonen, men backend fortsetter å fylle køen.
- **Stopp** lukker `EventSource`. Serveren oppdager lukkingen (`res.on('close')`) og avbryter agenten og det pågående API-kallet, så kostnaden stopper.
- Mistet forbindelse behandles som feil, men **ikke** hvis `ferdig`/`feil` allerede er mottatt. Serveren lukker strømmen etter siste hendelse, og det skal ikke se ut som en feil.

### 7. Hvordan kirkegården tegnes

```
 GET /api/repo ─► filer: ["package.json", "src/utils/dato.js", …]
        │
        ▼
 buildWorld(): grupper per mappe → soner (inngjerdede tomter, pakket i rader)
               1 fil = 1 gravstein (stil 0/1/2 ut fra hash av filnavnet)
        │
        ▼
 hver ramme:  bakgrunn → soner → gravsteiner → agent → tåke/flaggermus → mørke
              (mørket er en offscreen-canvas med «hull» rundt lykta og lyste graver)
```

Gravsteinens utseende styres av funnene på filen: ingen funn = grå stein, bare `begrav` = gravhaug
med blomst, minst ett `la_staa` = stein med grønt lys. Små ikoner under navnet viser hvilke verktøy
agenten har brukt på filen.

### 8. Live vs. demo

| | Live | Demo |
|---|---|---|
| «Modellen» | Claude via `@anthropic-ai/sdk` | `demo.js`: spiller av et manus |
| Verktøy | ekte | **ekte** (kjører mot `hjemsokt-repo`) |
| Funn | modellens egne vurderinger | faste, fra `demo-funn.json` |
| Krever | `ANTHROPIC_API_KEY` i `.env` | ingenting |
| Merkelapp | `LIVE · Claude` | `DEMO · manus, ikke AI` |

Begge går gjennom nøyaktig samme `kjørAgent`, `emit` og SSE, så frontend vet ikke forskjellen.

### 9. Sikkerhet og begrensninger

- Serveren lytter bare på `127.0.0.1`, fordi den bruker din API-nøkkel. Nøkkelen sendes aldri til nettleseren.
- Én kjøring om gangen (HTTP 429 hvis en agent allerede kjører).
- `les_fil`, `hent_git_historikk` og `registrer_funn` validerer stier med `path.relative`, så `../` og søskenmapper som `hjemsokt-repo-evil` blir avvist.
- Verktøysvar kuttes ved 2500 tegn før de sendes til nettleseren (modellen får hele).
- Frontend viser tekst via `esc()` (HTML-escape), så innhold fra filer og modell kan ikke injisere HTML.
- Agentens vurderinger må kontrolleres av et menneske før noe slettes.

### 10. Utvid

- **Nytt verktøy:** legg et objekt `{ definisjon, kjør }` i `verktøy` i `src/verktoy.js`. Det sendes automatisk til modellen. Vil du at frontend skal gå til en fil, la input ha feltet `fil`.
- **Ny hendelse:** `emit({ type: 'min' })` i `agent.js`, og et `case 'min'` i `begin()` i `public/index.html`.
- **Annet repo:** endre `REPO` og `GIT_LOGG` i `src/verktoy.js`. Kirkegården tegnes av `/api/repo`.
