// Agent-løkka. Hele «agent-greia» er dette: spør modellen, kjør verktøyene
// den ber om, send resultatene tilbake, gjenta til den er ferdig.
// Alt som skjer sendes som hendelser til `emit`, så frontend kan vise det live.

const MODELL = process.env.MODELL ?? 'claude-sonnet-5-5';

// Stopper en agent som går i ring før den brenner opp kostnadstaket.
export const MAX_ITERASJONER = Number(process.env.MAX_ITERASJONER ?? 40);

// SDK-et lastes først i live-modus, så demo-modus fungerer uten installerte pakker.
export async function anthropicModell() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const klient = new Anthropic();
  return ({ system, tools, messages, signal }) =>
    klient.messages.create(
      { model: MODELL, max_tokens: 16000, output_config: { effort: 'medium' }, system, tools, messages },
      { signal },
    );
}

export const modellnavn = MODELL;

const grå = (t) => `\x1b[90m${t}\x1b[0m`;
const oransje = (t) => `\x1b[38;5;208m${t}\x1b[0m`;

// Standard-emit for kommandolinja (npm start): skriver hendelsene til terminalen.
function konsollEmit(h) {
  if (h.type === 'tanke') console.log(grå(h.tekst));
  else if (h.type === 'kall') console.log(oransje(`→ ${h.navn}`) + grå(` ${JSON.stringify(h.input)}`));
  else if (h.type === 'svar') console.log(grå(`  ${h.feil ? '✖' : '✓'} ${h.tekst.length} tegn tilbake`));
  else if (h.type === 'funn') console.log(oransje(`⚰ ${h.dom}: ${h.tittel}`) + grå(` (${h.fil})`) + `\n  ${h.nekrolog}`);
  else if (h.type === 'ferdig') console.log((h.advarsel ? oransje(`\n✖ ${h.advarsel}\n`) : '\n') + h.sammendrag);
}

export async function kjørAgent({ system, oppgave, verktøy, modell, emit = konsollEmit, signal }) {
  modell ??= await anthropicModell();
  // Bare verktøy med en kjør-funksjon sendes til modellen.
  const aktive = verktøy.filter((v) => v.kjør);
  const etterNavn = new Map(aktive.map((v) => [v.definisjon.name, v]));
  const ctx = { funn: [] };
  const messages = [{ role: 'user', content: oppgave }];

  for (let i = 1; i <= MAX_ITERASJONER; i++) {
    if (signal?.aborted) return;
    const svar = await modell({ system, tools: aktive.map((v) => v.definisjon), messages, signal });
    messages.push({ role: 'assistant', content: svar.content });

    const tekst = svar.content.filter((b) => b.type === 'text').map((b) => b.text.trim()).filter(Boolean).join('\n');
    if (tekst && svar.stop_reason === 'tool_use') emit({ type: 'tanke', tekst });

    if (svar.stop_reason !== 'tool_use') {
      const grunn = svar.stop_reason === 'refusal' ? `Modellen avslo (${svar.stop_details?.category ?? 'ukjent grunn'}).` : null;
      emit({ type: 'ferdig', stopp: svar.stop_reason, iterasjoner: i, funn: ctx.funn.length, sammendrag: tekst, advarsel: grunn });
      return;
    }

    // Modellen kan be om flere verktøy samtidig. Alle resultatene må tilbake
    // i én og samme melding.
    const resultater = [];
    for (const k of svar.content.filter((b) => b.type === 'tool_use')) {
      emit({ type: 'kall', id: k.id, navn: k.name, input: k.input });
      const r = await kjørVerktøy(etterNavn, k, ctx);
      emit({
        type: 'svar', id: k.id, navn: k.name, feil: !!r.is_error,
        tekst: r.content.length > 2500 ? r.content.slice(0, 2500) + '\n…' : r.content,
        filer: filerIResultat(r.content),
      });
      if (k.name === 'registrer_funn' && !r.is_error) emit({ type: 'funn', ...k.input });
      resultater.push(r);
    }
    messages.push({ role: 'user', content: resultater });
  }

  emit({ type: 'ferdig', stopp: 'maks_iterasjoner', iterasjoner: MAX_ITERASJONER, funn: ctx.funn.length, sammendrag: '', advarsel: `Stoppet etter ${MAX_ITERASJONER} runder (MAX_ITERASJONER).` });
}

// Plukker ut «fil:linje:» fra søkeresultater, så frontend kan lyse opp gravene som fikk treff.
function filerIResultat(tekst) {
  return [...new Set([...tekst.matchAll(/^([\w./-]+\.\w+):\d+:/gm)].map((m) => m[1]))];
}

async function kjørVerktøy(etterNavn, kall, ctx) {
  const v = etterNavn.get(kall.name);
  if (!v) return feil(kall, `Ukjent verktøy «${kall.name}». Gyldige: ${[...etterNavn.keys()].join(', ')}`);
  try {
    const resultat = await v.kjør(kall.input, ctx);
    const tekst = typeof resultat === 'string' ? resultat : JSON.stringify(resultat, null, 2);
    return { type: 'tool_result', tool_use_id: kall.id, content: tekst };
  } catch (e) {
    return feil(kall, e.message);
  }
}

function feil(kall, melding) {
  return { type: 'tool_result', tool_use_id: kall.id, content: melding, is_error: true };
}
