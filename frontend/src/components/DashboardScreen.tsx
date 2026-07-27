import type { MeetingRecord } from "../types";
import ActionChecklist from "./ActionChecklist";

interface DashboardScreenProps {
  meetings: MeetingRecord[];
  onToggle: (meetingId: string, taskId: string) => void;
  onClear: () => void;
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h4l2 3h4l2-3h4" />
      <path d="M5.5 5h13l2.5 7v7a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-7l2.5-7z" />
    </svg>
  );
}

export default function DashboardScreen({ meetings, onToggle, onClear }: DashboardScreenProps) {
  const totalCount = meetings.reduce((sum, m) => sum + m.tasks.length, 0);
  const doneCount = meetings.reduce(
    (sum, m) => sum + m.tasks.filter((task) => task.status === "done").length,
    0,
  );
  const openCount = totalCount - doneCount;

  return (
    <div className="vn-page vn-page--dashboard">
      <div className="dashboard-header-row">
        <h1 className="result-title">대시보드</h1>
        {meetings.length > 0 && (
          <button type="button" className="dashboard-clear-btn" onClick={onClear}>
            전체 초기화
          </button>
        )}
      </div>

      {meetings.length === 0 ? (
        <div className="dashboard-empty">
          <InboxIcon />
          <p className="dashboard-empty-text">
            아직 저장된 회의가 없습니다.
            <br />
            메모를 입력해서 첫 회의를 분석해보세요.
          </p>
        </div>
      ) : (
        <>
          <div className="dashboard-stats-row">
            <span className="dashboard-stat-inline">
              전체 <strong>{totalCount}</strong>건
            </span>
            <span className="dashboard-stat-inline">
              완료 <strong>{doneCount}</strong>건
            </span>
            <span className="dashboard-stat-inline">
              남음 <strong>{openCount}</strong>건
            </span>
          </div>

          <div className="dashboard-list">
            {meetings.map((meeting) => {
              const meetingDone = meeting.tasks.filter((task) => task.status === "done").length;
              return (
                <section key={meeting.id} className="dashboard-meeting-card">
                  <div className="dashboard-meeting-top">
                    <span className="dashboard-meeting-date">
                      {new Date(meeting.createdAt).toLocaleString("ko-KR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>

                  <p className="result-summary-text">{meeting.summary}</p>

                  {meeting.tasks.length > 0 && (
                    <>
                      <span className="dashboard-meta-tag">
                        할 일 {meetingDone} / {meeting.tasks.length} 완료
                      </span>
                      <ActionChecklist items={meeting.tasks} onToggle={(taskId) => onToggle(meeting.id, taskId)} />
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
