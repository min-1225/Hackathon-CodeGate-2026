// VeilNote 할일 대시보드 저장소 (인메모리)
//
// 회의 처리(MEETING_PROCESS)가 뽑아낸 액션아이템을 그대로 할일로 적재하고,
// 체크박스 완료/미완료 토글을 관리한다. 새로운 LLM 호출은 일어나지 않는다.
//
// 보관 정책(프로토타입):
// - 프로세스 메모리에만 존재한다. 디스크에 쓰지 않는다 (프라이버시 정책 유지).
// - 저장되는 text/ownerToken은 전부 "토큰 상태"다. 원문 복원은 브라우저가 한다.

/** @type {Map<string, object>} taskId → task */
const tasks = new Map();

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

const PRIORITIES = new Set(['P1', 'P2', 'P3']);
const STATUSES = new Set(['open', 'done']);

/**
 * 회의 액션아이템 배열을 할일로 적재한다.
 * @param {object[]} actionItems  processMeeting()의 actionItems
 * @param {{ meetingId?: string, meetingTitle?: string }} meta
 * @returns {object[]} 생성된 할일 레코드
 */
export function addTasksFromActionItems(actionItems, meta = {}) {
  const meetingId = meta.meetingId || nextId('meeting');
  const createdAt = new Date().toISOString();

  return actionItems.map((item) => {
    const task = {
      id: nextId('task'),
      text: item.text,
      ownerToken: item.ownerToken ?? null,
      ownerReason: item.ownerReason ?? '',
      priority: PRIORITIES.has(item.priority) ? item.priority : 'P3',
      priorityReason: item.priorityReason ?? '',
      dueOffsetDays:
        Number.isInteger(item.dueOffsetDays) ? item.dueOffsetDays : null,
      dueReason: item.dueReason ?? '',
      status: 'open',
      source: 'meeting',
      meetingId,
      meetingTitle: meta.meetingTitle || '',
      createdAt,
      completedAt: null,
    };
    tasks.set(task.id, task);
    return task;
  });
}

/**
 * 할일 목록 조회. 미완료 먼저, 그 안에서 P1 → P3 → 생성순.
 * @param {{ status?: string, ownerToken?: string, meetingId?: string }} filter
 */
export function listTasks(filter = {}) {
  const order = { P1: 0, P2: 1, P3: 2 };
  return [...tasks.values()]
    .filter((t) => !filter.status || t.status === filter.status)
    .filter((t) => !filter.ownerToken || t.ownerToken === filter.ownerToken)
    .filter((t) => !filter.meetingId || t.meetingId === filter.meetingId)
    .sort(
      (a, b) =>
        (a.status === 'done') - (b.status === 'done') ||
        order[a.priority] - order[b.priority] ||
        a.createdAt.localeCompare(b.createdAt)
    );
}

export function getTask(id) {
  return tasks.get(id) || null;
}

/**
 * 할일 갱신. 체크박스 토글이 주 용도.
 * @param {string} id
 * @param {{ status?: 'open'|'done', text?: string, ownerToken?: string|null, priority?: string }} patch
 * @returns {object|null} 갱신된 할일, 없으면 null
 * @throws {Error} 허용되지 않는 값이면 던진다 (호출부에서 400 처리)
 */
export function updateTask(id, patch = {}) {
  const task = tasks.get(id);
  if (!task) return null;

  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) {
      throw new Error("status는 'open' 또는 'done'이어야 합니다.");
    }
    task.status = patch.status;
    task.completedAt =
      patch.status === 'done' ? new Date().toISOString() : null;
  }

  if (patch.text !== undefined) {
    if (typeof patch.text !== 'string' || !patch.text.trim()) {
      throw new Error('text는 비어 있지 않은 문자열이어야 합니다.');
    }
    task.text = patch.text.trim();
  }

  // 담당자 수동 재배정 — AI 배정을 사람이 덮어쓸 수 있어야 한다.
  if (patch.ownerToken !== undefined) {
    if (patch.ownerToken !== null && typeof patch.ownerToken !== 'string') {
      throw new Error('ownerToken은 문자열 또는 null이어야 합니다.');
    }
    task.ownerToken = patch.ownerToken;
    task.ownerReason = patch.ownerToken === null ? '' : '사용자가 직접 배정';
  }

  if (patch.priority !== undefined) {
    if (!PRIORITIES.has(patch.priority)) {
      throw new Error('priority는 P1/P2/P3 중 하나여야 합니다.');
    }
    task.priority = patch.priority;
    task.priorityReason = '사용자가 직접 조정';
  }

  return task;
}

export function deleteTask(id) {
  return tasks.delete(id);
}

/** 대시보드 상단 카운터용 집계. */
export function taskStats() {
  const all = [...tasks.values()];
  const open = all.filter((t) => t.status === 'open');
  return {
    total: all.length,
    open: open.length,
    done: all.length - open.length,
    byPriority: {
      P1: open.filter((t) => t.priority === 'P1').length,
      P2: open.filter((t) => t.priority === 'P2').length,
      P3: open.filter((t) => t.priority === 'P3').length,
    },
    unassigned: open.filter((t) => t.ownerToken === null).length,
  };
}

/** 테스트/데모용 초기화. */
export function resetTasks() {
  tasks.clear();
}
