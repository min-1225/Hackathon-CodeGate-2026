import type { Task } from "../types";

interface ActionChecklistProps {
  items: Task[];
  onToggle: (taskId: string) => void;
}

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  P1: "P1 · 긴급",
  P2: "P2 · 이번 주",
  P3: "P3 · 미정",
};

export default function ActionChecklist({ items, onToggle }: ActionChecklistProps) {
  if (items.length === 0) {
    return <p className="body-text body-text--muted">액션 아이템이 없습니다.</p>;
  }

  return (
    <ul className="action-checklist">
      {items.map((item) => (
        <li
          key={item.id}
          className={`action-checklist-item ${item.status === "done" ? "action-checklist-item--done" : ""}`}
        >
          <label className="action-checklist-label">
            <input
              type="checkbox"
              className="action-checklist-checkbox"
              checked={item.status === "done"}
              onChange={() => onToggle(item.id)}
            />
            <span className="action-checklist-content">
              <span className="action-checklist-task">{item.text}</span>
              <span className="action-checklist-owner">
                담당 제안: {item.ownerToken ?? "미배정"} · {PRIORITY_LABEL[item.priority]}
              </span>
            </span>
            {item.status === "done" && <span className="action-checklist-badge">완료</span>}
          </label>
        </li>
      ))}
    </ul>
  );
}
