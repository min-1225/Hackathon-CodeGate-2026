// VeilNote 백엔드 서버 (Express) — API 전용
//
// 역할:
//   1) 비식별화된 토큰 회의록 → LLM 1회 호출 → 요약 · 결정 · 액션아이템
//   2) 그 액션아이템을 그대로 할일 대시보드에 적재하고 체크박스 완료를 관리
//
// 프론트엔드는 별도 저장소에서 담당한다. 이 서버는 정적 파일을 제공하지 않는다.
//
// 보안 정책(프로토타입):
// - 회의 엔드포인트는 토큰화된 텍스트만 받는다. 원문/매핑테이블은 받지 않는다.
// - 전송 직전 서버측 유출 게이트(leakGuard)를 통과해야만 LLM으로 넘어간다.
// - 요청·응답을 디스크에 저장하지 않고, 본문 내용은 로그에도 남기지 않는다.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { processMeeting, meetingProcessConfig } from './meetingProcess.js';
import { tokenize, restore, buildDetections } from './shared/tokenizer.js';
import { scanResidualPII, summarizeFindings } from './shared/leakGuard.js';
import {
  addTasksFromActionItems,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
  taskStats,
} from './taskStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// 프론트엔드가 별도 오리진(vite dev 서버 등)에서 붙는다.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

app.use(express.json({ limit: '1mb' }));

// 공용 순수모듈(src/shared) — 브라우저가 토큰화에 그대로 import 한다.
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// 요청 로깅 (본문 내용은 남기지 않음 — 프라이버시)
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'veilnote-backend',
    model: meetingProcessConfig.MODEL,
    effort: meetingProcessConfig.EFFORT,
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

/**
 * POST /api/process-meeting   ★ 메인 엔드포인트
 * 토큰화된 회의 전문 → 전사 교정 · 요약 · 결정 · 액션아이템.
 * 액션아이템은 곧바로 할일로 적재된다.
 *
 * body: {
 *   transcriptTokenized: string,   // 필수. 토큰만
 *   participantTokens?: string[],  // ['[PERSON_1]', ...] — 담당자 환각 방지 화이트리스트
 *   meetingTitle?: string
 * }
 * → { summary, decisions, tasks: [...할일 레코드], personalStar: {situation,task,action,result}, _meta }
 *
 * 서버측 잔여 PII 게이트를 통과해야만 LLM을 호출한다 (통과 못하면 422).
 */
app.post('/api/process-meeting', async (req, res) => {
  const { transcriptTokenized, participantTokens, meetingTitle } =
    req.body || {};

  if (typeof transcriptTokenized !== 'string' || !transcriptTokenized.trim()) {
    return res
      .status(400)
      .json({ error: 'transcriptTokenized(문자열)가 필요합니다.' });
  }

  // 레이어 ③(B) — 서버측 잔여 PII 게이트 (클라이언트 assertNoRawEntity의 서버 방어선)
  const scan = scanResidualPII(transcriptTokenized);
  if (!scan.clean) {
    console.warn(
      `전송 차단(RESIDUAL_PII_BLOCKED): ${scan.blocking
        .map((f) => f.type)
        .join(', ')}`
    );
    return res.status(422).json({
      error: '전송 차단: 토큰화되지 않은 개인정보가 남아 있습니다.',
      code: 'RESIDUAL_PII_BLOCKED',
      findings: summarizeFindings(scan.blocking),
    });
  }

  try {
    const result = await processMeeting({
      transcriptTokenized,
      participantTokens: Array.isArray(participantTokens)
        ? participantTokens
        : [],
      meetingTitle: typeof meetingTitle === 'string' ? meetingTitle : undefined,
    });

    // 회의 → 실제 업무. 추가 LLM 호출 없이 액션아이템을 그대로 할일로 적재한다.
    const tasks = addTasksFromActionItems(result.actionItems, { meetingTitle });

    return res.json({
      corrections: result.corrections,
      summary: result.summary,
      decisions: result.decisions,
      tasks,
      personalStar: result.personalStar,
      _meta: result._meta,
    });
  } catch (err) {
    console.error('process-meeting 오류:', err.message);
    return res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/tasks  — 할일 대시보드 목록
 * query: status=open|done, ownerToken=[PERSON_1], meetingId=...
 * → { tasks, stats }
 */
app.get('/api/tasks', (req, res) => {
  const { status, ownerToken, meetingId } = req.query;
  if (status && status !== 'open' && status !== 'done') {
    return res.status(400).json({ error: "status는 open 또는 done입니다." });
  }
  return res.json({
    tasks: listTasks({ status, ownerToken, meetingId }),
    stats: taskStats(),
  });
});

/**
 * PATCH /api/tasks/:id  — 체크박스 토글 및 수동 수정
 * body: { status?: 'open'|'done', text?, ownerToken?, priority? }
 */
app.patch('/api/tasks/:id', (req, res) => {
  const { status, text, ownerToken, priority } = req.body || {};
  const patch = {};
  if (status !== undefined) patch.status = status;
  if (text !== undefined) patch.text = text;
  if (ownerToken !== undefined) patch.ownerToken = ownerToken;
  if (priority !== undefined) patch.priority = priority;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: '변경할 필드가 없습니다.' });
  }

  try {
    const task = updateTask(req.params.id, patch);
    if (!task) return res.status(404).json({ error: '할일을 찾을 수 없습니다.' });
    return res.json({ task, stats: taskStats() });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/tasks/:id */
app.delete('/api/tasks/:id', (req, res) => {
  if (!deleteTask(req.params.id)) {
    return res.status(404).json({ error: '할일을 찾을 수 없습니다.' });
  }
  return res.json({ ok: true, stats: taskStats() });
});

/** GET /api/tasks/:id */
app.get('/api/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '할일을 찾을 수 없습니다.' });
  return res.json({ task });
});

/**
 * POST /api/demo/detect   ⚠️ 데모 전용
 * 규칙(+사전) 기반 자동 탐지 결과를 반환. (브라우저는 여기에 NER를 추가)
 * body: { rawText: string, dictionary?: object }
 */
app.post('/api/demo/detect', (req, res) => {
  const { rawText, dictionary } = req.body || {};
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: 'rawText(문자열)가 필요합니다.' });
  }
  const detections = buildDetections(rawText, { dictionary: dictionary || {} });
  return res.json({ detections });
});

/**
 * POST /api/demo/tokenize   ⚠️ 데모 전용
 * 실서비스에서는 브라우저가 담당하는 토큰화. 매핑 테이블을 반환하지만 서버는 저장하지 않는다.
 * body: { rawText: string, dictionary?: object }
 */
app.post('/api/demo/tokenize', (req, res) => {
  const { rawText, dictionary } = req.body || {};
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: 'rawText(문자열)가 필요합니다.' });
  }
  const { tokenized, mapping } = tokenize(rawText, dictionary || {});
  return res.json({ tokenized, mapping });
});

/**
 * POST /api/demo/restore   ⚠️ 데모 전용
 * body: { data: any, mapping: object }
 */
app.post('/api/demo/restore', (req, res) => {
  const { data, mapping } = req.body || {};
  if (!mapping || typeof mapping !== 'object') {
    return res.status(400).json({ error: 'mapping(객체)이 필요합니다.' });
  }
  return res.json({ restored: restore(data, mapping) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VeilNote 백엔드(API)가 http://localhost:${PORT} 에서 실행 중`);
  console.log(
    `  모델: ${meetingProcessConfig.MODEL} / effort: ${meetingProcessConfig.EFFORT}`
  );
  console.log(
    `  API 키: ${process.env.ANTHROPIC_API_KEY ? '설정됨' : '없음 (LLM 호출 불가)'}`
  );
});
