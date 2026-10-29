// Demo-modus uten API-nøkkel. Dette er IKKE en AI: «modellen» spiller av et manus.
// Verktøykallene kjører likevel for ekte mot koden i hjemsokt-repo, slik at
// frontend og verktøyene kan testes uten nøkkel. Frontend merker det tydelig som demo.
import { createRequire } from 'node:module';
const funn = createRequire(import.meta.url)('./demo-funn.json');

const pause = (ms, signal) => new Promise((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

let n = 0;
const kall = (name, input) => ({ type: 'tool_use', id: `demo_${++n}`, name, input });

export function demoModell() {
  const runder = [
    {
      content: [
        { type: 'text', text: '(DEMO, manus) Starter med å lete etter åpenbare dødsmerker: TODO og skippede tester.' },
        kall('sok_i_repo', { monster: 'TODO' }),
        kall('sok_i_repo', { monster: '\\.skip\\(', regex: true }),
      ],
    },
  ];
  for (const f of funn) {
    runder.push({
      content: [
        { type: 'text', text: `(DEMO, manus) Mistenkelig: ${f.tittel}. Sjekker om noe bruker det.` },
        kall('sok_i_repo', { monster: f.sok }),
        kall('les_fil', { fil: f.fil }),
        kall('finn_referanser', { navn: f.navn }),
        kall('hent_git_historikk', { fil: f.fil }),
      ],
    });
    runder.push({
      content: [kall('registrer_funn', { fil: f.fil, tittel: f.tittel, dom: f.dom, nekrolog: f.nekrolog, begrunnelse: f.begrunnelse })],
    });
  }
  const slutt = {
    content: [{ type: 'text', text: `(DEMO) Ferdig. ${funn.filter((f) => f.dom === 'begrav').length} funn kan begraves, ${funn.filter((f) => f.dom === 'la_staa').length} ser døde ut, men lever. Dette var et manus, ikke en AI-vurdering.` }],
    stop_reason: 'end_turn',
  };
  let i = 0;
  return async ({ signal }) => {
    await pause(700, signal);
    return i < runder.length ? { ...runder[i++], stop_reason: 'tool_use' } : slutt;
  };
}
