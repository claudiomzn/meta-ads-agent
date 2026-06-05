import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface CopyCriteria {
  headline?: string;
  body?: string;
  cta?: string;
}

export interface CriterionScore {
  score: number;      // 0-10
  label: string;
  feedback: string;
  passed: boolean;
}

export interface CriteriaScores {
  visualHierarchy: CriterionScore;
  textArea: CriterionScore;
  humanElement: CriterionScore;
  contrast: CriterionScore;
  productFocus: CriterionScore;
  emotionalAppeal: CriterionScore;
  ctaVisibility: CriterionScore;
  copyCoherence: CriterionScore;
}

export interface FormatScore {
  score: number;
  recommendation: string;
}

export interface FormatScores {
  feed: FormatScore;
  stories: FormatScore;
  reels: FormatScore;
}

export interface Improvement {
  priority: 'alta' | 'media' | 'baixa';
  problem: string;
  solution: string;
  estimatedImpact: string;
}

export interface AnalysisResult {
  overallScore: number;
  summary: string;
  criteria: CriteriaScores;
  formatScores: FormatScores;
  strengths: string[];
  improvements: Improvement[];
  approvalRecommendation: 'aprovado' | 'aprovar_com_ressalvas' | 'reprovar';
  approvalReason: string;
}

export interface ComparisonResult {
  winner: 'A' | 'B' | 'empate';
  confidenceLevel: number;
  winnerReason: string;
  keyDifferences: string[];
  abTestRecommendation: string;
  projectedCtrDifference: string;
  analysisA: AnalysisResult;
  analysisB: AnalysisResult;
}

export interface PatternResult {
  hasEnoughData: boolean;
  totalAnalyzed?: number;
  patterns?: string[];
  scoreVsPerformance?: string;
  winnerCharacteristics?: string[];
  loserCharacteristics?: string[];
  dataPoints?: Array<{ score: number; ctr: number; fileName: string }>;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function extractJson(text: string): string {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  const start = text.indexOf('{');
  const startArr = text.indexOf('[');
  const s = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (s === -1) return text.trim();
  let depth = 0; let inString = false; let escape = false;
  const openChar = text[s]; const closeChar = openChar === '{' ? '}' : ']';
  for (let i = s; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return text.trim();
}

async function imageToBase64(filePath: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mediaTypeMap: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  };
  return { data: buffer.toString('base64'), mediaType: mediaTypeMap[ext] ?? 'image/jpeg' };
}

const SYSTEM_PROMPT = `Você é um especialista sênior em criativos para Meta Ads com 10+ anos de experiência.
Analisa imagens de anúncios com foco em performance real: CTR, conversão e qualidade visual.
Retorne APENAS JSON válido. Português brasileiro. Sem markdown, sem texto extra.`;

// ── analyzeImage ─────────────────────────────────────────────────────────────

export async function analyzeImage(filePath: string, copy?: CopyCriteria): Promise<AnalysisResult> {
  const { data, mediaType } = await imageToBase64(filePath);

  const copySection = copy
    ? `\nCopy do anúncio:\n- Headline: ${copy.headline ?? 'não informada'}\n- Body: ${copy.body ?? 'não informado'}\n- CTA: ${copy.cta ?? 'não informado'}`
    : '\nCopy: não fornecida (analise apenas o visual)';

  const prompt = `Analise este criativo para Meta Ads.${copySection}

Avalie os 8 critérios abaixo (score 0-10 cada) e retorne APENAS este JSON:
{
  "overallScore": 7.5,
  "summary": "resumo em 2 frases",
  "criteria": {
    "visualHierarchy": {"score": 8, "label": "Hierarquia Visual", "feedback": "...", "passed": true},
    "textArea": {"score": 7, "label": "Área de Texto", "feedback": "...", "passed": true},
    "humanElement": {"score": 6, "label": "Elemento Humano", "feedback": "...", "passed": true},
    "contrast": {"score": 8, "label": "Contraste e Legibilidade", "feedback": "...", "passed": true},
    "productFocus": {"score": 7, "label": "Foco no Produto", "feedback": "...", "passed": true},
    "emotionalAppeal": {"score": 7, "label": "Apelo Emocional", "feedback": "...", "passed": true},
    "ctaVisibility": {"score": 8, "label": "Visibilidade do CTA", "feedback": "...", "passed": true},
    "copyCoherence": {"score": 7, "label": "Coerência com Copy", "feedback": "...", "passed": true}
  },
  "formatScores": {
    "feed": {"score": 8, "recommendation": "..."},
    "stories": {"score": 6, "recommendation": "..."},
    "reels": {"score": 5, "recommendation": "..."}
  },
  "strengths": ["ponto 1", "ponto 2", "ponto 3"],
  "improvements": [
    {"priority": "alta", "problem": "...", "solution": "...", "estimatedImpact": "..."},
    {"priority": "media", "problem": "...", "solution": "...", "estimatedImpact": "..."}
  ],
  "approvalRecommendation": "aprovado",
  "approvalReason": "motivo em 1 frase"
}
Regras: feedback máx 80 chars, strengths máx 3 itens, improvements máx 4 itens.`;

  const response = await getClient().messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return JSON.parse(extractJson(text)) as AnalysisResult;
}

// ── compareCreatives ──────────────────────────────────────────────────────────

export async function compareCreatives(
  pathA: string,
  pathB: string,
  copyA?: CopyCriteria,
  copyB?: CopyCriteria,
): Promise<ComparisonResult> {
  // Analisa os dois em paralelo
  const [analysisA, analysisB] = await Promise.all([
    analyzeImage(pathA, copyA),
    analyzeImage(pathB, copyB),
  ]);

  const { data: dataA, mediaType: mtA } = await imageToBase64(pathA);
  const { data: dataB, mediaType: mtB } = await imageToBase64(pathB);

  const prompt = `Compare estes dois criativos para Meta Ads A/B test.
Criativo A tem score ${analysisA.overallScore.toFixed(1)}/10.
Criativo B tem score ${analysisB.overallScore.toFixed(1)}/10.

Retorne APENAS este JSON:
{
  "winner": "A",
  "confidenceLevel": 78,
  "winnerReason": "motivo em 1 frase",
  "keyDifferences": ["diferença 1", "diferença 2", "diferença 3"],
  "abTestRecommendation": "recomendação em 2 frases",
  "projectedCtrDifference": "+15-25% para o criativo A"
}`;

  const compResponse = await getClient().messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mtA, data: dataA } },
        { type: 'image', source: { type: 'base64', media_type: mtB, data: dataB } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = compResponse.content[0].type === 'text' ? compResponse.content[0].text : '{}';
  const comparison = JSON.parse(extractJson(text));

  return { ...comparison, analysisA, analysisB };
}

// ── analyzeHistoricalPatterns ─────────────────────────────────────────────────

export async function analyzeHistoricalPatterns(
  userId: string,
  adAccountId?: string,
): Promise<PatternResult> {
  const { default: prisma } = await import('../lib/prisma.js');

  const where: Record<string, unknown> = { userId, realCtr: { not: null } };
  if (adAccountId) where.adAccountId = adAccountId;

  const analyses = await prisma.creativeAnalysis.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, fileName: true, overallScore: true,
      realCtr: true, realCpl: true, realRoas: true,
      approvalRecommendation: true, strengths: true,
    },
  });

  if (analyses.length < 5) return { hasEnoughData: false };

  const dataPoints = analyses.map((a) => ({
    score: a.overallScore,
    ctr: a.realCtr ?? 0,
    fileName: a.fileName,
  }));

  const prompt = `Analise estes dados históricos de ${analyses.length} criativos Meta Ads.

Dados (score IA vs CTR real):
${dataPoints.map((d, i) => `${i + 1}. ${d.fileName}: score=${d.score.toFixed(1)}, CTR=${d.ctr.toFixed(2)}%`).join('\n')}

Retorne APENAS este JSON:
{
  "patterns": ["padrão 1", "padrão 2", "padrão 3"],
  "scoreVsPerformance": "correlação em 2 frases",
  "winnerCharacteristics": ["característica 1", "característica 2"],
  "loserCharacteristics": ["problema 1", "problema 2"]
}`;

  const response = await getClient().messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const insights = JSON.parse(extractJson(text));

  return {
    hasEnoughData: true,
    totalAnalyzed: analyses.length,
    dataPoints,
    ...insights,
  };
}
