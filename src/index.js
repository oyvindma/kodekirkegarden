// Startpunktet: npm start -- "spørsmålet ditt"
import { kjørAgent } from './agent.js';
import { system, eksempelOppgave, verktøy } from './verktoy.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Mangler ANTHROPIC_API_KEY. Kopier .env til .env og lim inn nøkkelen.');
  process.exit(1);
}

const oppgave = process.argv.slice(2).join(' ') || eksempelOppgave;
console.log(`\n🎃 ${oppgave}\n`);

await kjørAgent({ system, oppgave, verktøy });
