import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import { interpretCapture, type InterpretationProvider } from '../src/interpretation.js';
import { groundCaptureWithLaya } from '../src/laya-grounding.js';

type CaptureEval = {
  id: string;
  capture: string;
  allowedKinds: string[];
  horizon: string | null;
  titleMustNotContain?: string[];
};

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY to run the capture model evaluation.');

const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const openai = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
const provider: InterpretationProvider = {
  async complete(request) {
    return (await openai.responses.create(request)).output_text;
  },
};
const cases = JSON.parse(await readFile(new URL('../evals/capture-evals.json', import.meta.url), 'utf8')) as CaptureEval[];
let failures = 0;

for (const scenario of cases) {
  try {
    const laya = await groundCaptureWithLaya(scenario.capture);
    const result = await interpretCapture(provider, model, scenario.capture, undefined, laya);
    const issues: string[] = [];
    if (!scenario.allowedKinds.includes(result.kind)) issues.push(`kind=${result.kind}; expected ${scenario.allowedKinds.join(' or ')}`);
    if (result.horizon !== scenario.horizon) issues.push(`horizon=${result.horizon}; expected ${scenario.horizon}`);
    for (const phrase of scenario.titleMustNotContain ?? []) {
      if (result.title.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())) issues.push(`title contains invented or unsafe phrase: ${phrase}`);
    }
    if (issues.length) failures++;
    console.log(`${issues.length ? 'FAIL' : 'PASS'} ${scenario.id}: Laya suggested ${laya.candidateKind}/${laya.candidateHorizon ?? 'null'} (${laya.kindConfidence.toFixed(2)}, ${laya.horizonConfidence.toFixed(2)}); OpenAI chose ${result.kind}/${result.horizon ?? 'null'} — ${result.title}${issues.length ? ` (${issues.join('; ')})` : ''}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${scenario.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Capture eval: ${cases.length - failures}/${cases.length} passed using ${model}.`);
if (failures) process.exitCode = 1;
