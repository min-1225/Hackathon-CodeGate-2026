// 엔드투엔드 데모: 원문 → 하이브리드 탐지 → 토큰화 → 유출검사(2겹) → LLM → 할일 대시보드 → 복원
//
// 실행: node scripts/demo.js
// - ANTHROPIC_API_KEY가 있으면 실제 Claude 호출까지, 없으면 그 전 단계까지 시연.

import 'dotenv/config';
import {
  buildDetections,
  applyTokenization,
  restore,
} from '../src/shared/tokenizer.js';
import {
  checkResidualOriginals,
  scanResidualPII,
  summarizeFindings,
} from '../src/shared/leakGuard.js';
import { processMeeting } from '../src/meetingProcess.js';
import {
  addTasksFromActionItems,
  listTasks,
  updateTask,
  taskStats,
} from '../src/taskStore.js';

// 원문 회의 메모 (민감정보 포함) — 브라우저를 떠나지 않는다고 가정.
// "남품 / 노의 / 단까 / 제산정 / 수영했습니다 / 견적써"는 온디바이스 음성인식이 실제로
// 내는 종류의 오인식을 일부러 심어둔 것. LLM이 토큰은 그대로 둔 채 문맥으로 교정한다.
const rawTranscript = `
소지윤: 이번 분기 가나다마트 남품 계약 건 노의합니다. 계약 규모는 3억 5천만원 수준이에요. 담당자 연락처는 010-1234-5678, 이메일은 buyer@ganada.co.kr 입니다.
김대리: 테크컴퍼니 쪽 물류 단까가 올라서 마진이 빠듯합니다. 제가 원가 제산정 자료를 만들었어요.
소지윤: 제가 가나다마트 구매팀과 협상해서 납기를 2주 늦추는 대신 단가를 3% 올리는 안을 제안했고, 상대가 수영했습니다.
김대리: 그럼 다음 주 금요일까지 최종 견적써를 가나다마트에 보내면 되겠네요.
소지윤: 네, 견적서 발송은 김대리가 맡아주시고, 계약서 초안은 제가 검토하겠습니다.
`.trim();

// 사전 = 문맥 의존 개체(브라우저 NER가 잡을 부분)를 데모에서 대체
const dictionary = {
  PERSON: ['소지윤', '김대리'],
  CLIENT: ['가나다마트'],
  ORG: ['테크컴퍼니'],
};

function hr(t) {
  console.log(`\n=== ${t} ===`);
}

async function main() {
  hr('1. 원문 (서버로 절대 안 보냄)');
  console.log(rawTranscript);

  // 레이어 ① 하이브리드 탐지 (여기선 규칙 + 사전; 브라우저에선 + 온디바이스 NER)
  hr('2. 탐지 결과 (규칙 + 사전)');
  const detections = buildDetections(rawTranscript, { dictionary });
  for (const d of detections) {
    console.log(`  [${d.type}] "${d.value}"  (${d.source}, conf ${d.confidence})`);
  }

  // 레이어 ② 사람이 확정 — 데모에서는 전부 확정했다고 가정하고 그대로 토큰화
  const { tokenized, mapping } = applyTokenization(rawTranscript, detections);
  hr('3. 토큰화 결과 (이것만 서버로 전송)');
  console.log(tokenized);

  // 레이어 ③(A) 클라이언트 역방향 유출검사 — 원본이 남아있으면 전송 금지
  hr('4. 유출검사 (A) 클라이언트: 원본 대조');
  const client = checkResidualOriginals(tokenized, mapping);
  console.log(client.safe ? '  ✅ 원본 잔존 없음 — 안전' : `  ❌ 유출: ${JSON.stringify(client.leaked)}`);

  // 레이어 ③(B) 서버 게이트 시뮬레이션 — 잔여 PII 패턴 검사
  hr('5. 유출검사 (B) 서버 게이트: 잔여 PII 패턴');
  const server = scanResidualPII(tokenized);
  console.log(server.clean ? '  ✅ 잔여 PII 없음 — LLM 전송 허용' : `  ❌ 차단: ${JSON.stringify(summarizeFindings(server.blocking))}`);

  // 게이트가 진짜 막는지 보여주는 반례: 이메일을 일부러 남겨보기
  hr('6. 안전장치 검증: 이메일을 일부러 안 가린 경우');
  const leaky = tokenized + '\n(참고) 담당자 이메일 leak@ganada.co.kr';
  const leakScan = scanResidualPII(leaky);
  console.log(leakScan.clean ? '  (예상과 다름)' : `  ✅ 서버가 차단함: ${JSON.stringify(summarizeFindings(leakScan.blocking))}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\n⚠️ ANTHROPIC_API_KEY 없음 → LLM 호출 생략. .env 설정 후 다시 실행.');
    return;
  }

  // 회의 처리 (토큰만 전송, LLM 호출 1회)
  const participantTokens = Object.keys(mapping).filter((t) =>
    t.startsWith('[PERSON_')
  );
  hr('7. 회의 처리 중 (토큰만 전송)...');
  const ai = await processMeeting({
    transcriptTokenized: tokenized,
    participantTokens,
    meetingTitle: '분기 납품 계약 논의',
  });
  if (ai.corrections.length > 0) {
    console.log('전사 오류 교정 (오디오·원문은 로컬에만 있음):');
    for (const c of ai.corrections) {
      console.log(`  "${c.before}" → "${c.after}"`);
    }
  }
  console.log('요약:', ai.summary);
  console.log('결정사항:', ai.decisions);
  console.log('사용량:', ai._meta.usage);

  // 액션아이템 → 할일 대시보드 (추가 LLM 호출 없음)
  hr('8. 할일 대시보드 적재');
  const created = addTasksFromActionItems(ai.actionItems, {
    meetingTitle: '분기 납품 계약 논의',
  });
  for (const t of created) {
    console.log(
      `  [ ] ${t.priority} ${t.text}  — 담당 ${t.ownerToken ?? '미배정'} (${t.ownerReason})`
    );
  }

  // 체크박스 완료 처리 시연
  hr('9. 첫 항목 체크 → 완료 처리');
  if (created[0]) {
    updateTask(created[0].id, { status: 'done' });
  }
  for (const t of listTasks()) {
    console.log(`  [${t.status === 'done' ? 'x' : ' '}] ${t.priority} ${t.text}`);
  }
  console.log('집계:', taskStats());

  // 클라이언트: 복원
  hr('10. 복원된 최종 결과 (기기에서 재치환)');
  const restored = restore(
    { summary: ai.summary, decisions: ai.decisions, tasks: listTasks() },
    mapping
  );
  console.log(JSON.stringify(restored, null, 2));
}

main().catch((e) => {
  console.error('데모 실패:', e.message);
  process.exit(1);
});
