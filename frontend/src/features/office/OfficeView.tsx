/* 사무소 관리 (관리자, PRD I1·I2): 중개사 계정 만들기·정지(담당 고객·매물·진행 중 거래 인계)·다시 사용,
   고객 연락처를 담당 중개사만 보게 하는 사무소 설정. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { ViewProps } from "@/App";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useUser } from "@/state/session";
import { useBusy, useToast, useUi } from "@/state/ui";

type User = {
  id: number; name: string; email: string; role: "agent" | "admin"; active: boolean; disabled_at: string | null;
  customers: number; listings: number; deals: number;
};
type Settings = { contact_owner_only: boolean };

export default function OfficeView(_: ViewProps) {
  const me = useUser();
  const toast = useToast();
  const qc = useQueryClient();
  const { openDialog } = useUi();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<User[]>("GET", "/admin/users") });
  const settings = useQuery({ queryKey: ["office-settings"], queryFn: () => api<Settings>("GET", "/office/settings") });
  const [busy, run] = useBusy();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const setContact = async (on: boolean) => {
    const r = await run(() => api<Settings>("PUT", "/office/settings", { contact_owner_only: on }));
    if (r) {
      qc.setQueryData(["office-settings"], r);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      toast(on ? "고객 연락처는 이제 담당 중개사와 관리자만 봅니다." : "사무소 전원이 고객 연락처(가림 표시)를 봅니다.");
    }
  };

  const active = (users.data || []).filter((u) => u.active);
  const disable = (u: User) => openDialog((close) => (
    <DisableDialog user={u} heirs={active.filter((x) => x.id !== u.id)} close={close}
      onDone={(msg) => { close(); toast(msg, 4200); void refresh(); }} />
  ));
  const enable = async (u: User) => {
    const r = await run(() => api("POST", `/admin/users/${u.id}/enable`));
    if (r) { toast(`${u.name} 계정을 다시 쓸 수 있습니다.`); void refresh(); }
  };

  return (
    <main id="view-office" className="view view-page">
      <div className="page-head"><h1>사무소</h1><span className="muted">{me.tenant_name}</span></div>

      <section className="sec" id="office-settings">
        <div className="sec-h"><h2>개인정보</h2></div>
        <label className="check-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" id="contact-owner-only" checked={Boolean(settings.data?.contact_owner_only)}
            disabled={busy || !settings.data} onChange={(e) => setContact(e.target.checked)} />
          고객 연락처는 담당 중개사와 관리자만 보기
        </label>
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          연락처·의뢰인 연락처·출입 정보는 암호화해 저장하고, 목록에는 끝 4자리만 보입니다. 원문을 볼 때마다 감사 기록이 남습니다.
        </p>
      </section>

      <section className="sec" id="office-users">
        <div className="sec-h"><h2>중개사 계정</h2><span className="muted">활성 {active.length}명</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>이름</th><th>이메일</th><th>역할</th><th className="r">고객</th><th className="r">매물</th><th className="r">진행 거래</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {(users.data || []).map((u) => (
                <tr key={u.id} data-user={u.id} className={u.active ? "" : "is-other"}>
                  <td><b>{u.name}</b>{u.id === me.id && <span className="muted"> (나)</span>}</td>
                  <td>{u.email}</td>
                  <td>{u.role === "admin" ? "관리자" : "중개사"}</td>
                  <td className="r num">{u.customers}</td><td className="r num">{u.listings}</td><td className="r num">{u.deals}</td>
                  <td>{u.active ? "사용 중" : `정지 ${day(u.disabled_at)}`}</td>
                  <td>
                    {u.id !== me.id && (u.active
                      ? <button type="button" className="btn btn--sm" data-act="disable-user" onClick={() => disable(u)}>정지·인계</button>
                      : <button type="button" className="btn btn--sm" data-act="enable-user" disabled={busy} onClick={() => enable(u)}>다시 사용</button>)}
                  </td>
                </tr>
              ))}
              {users.isLoading && <tr><td colSpan={8} className="loading">불러오는 중…</td></tr>}
            </tbody>
          </table>
        </div>
        <NewUserForm onCreated={(u) => { toast(`${u.name} 계정을 만들었습니다. 처음 비밀번호를 직접 전달하세요.`, 4200); void refresh(); }} />
      </section>
    </main>
  );
}

function NewUserForm({ onCreated }: { onCreated: (u: User) => void }) {
  const [busy, run] = useBusy();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = { name: String(f.get("name") || "").trim(), email: String(f.get("email") || "").trim(),
      password: String(f.get("password") || ""), role: String(f.get("role") || "agent") };
    const u = await run(() => api<User>("POST", "/admin/users", body));
    if (u) { form.reset(); onCreated(u); }
  };
  return (
    <form className="form" id="new-user-form" onSubmit={submit} style={{ marginTop: 12, maxWidth: 560 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>계정 추가</h3>
      <div className="row2">
        <label>이름 *<input name="name" required maxLength={40} /></label>
        <label>이메일 *<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      </div>
      <div className="row2">
        <label>처음 비밀번호 * (8자 이상)<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <label>역할<select name="role" defaultValue="agent"><option value="agent">중개사</option><option value="admin">관리자</option></select></label>
      </div>
      <div className="btns"><button type="submit" className="btn btn--main" disabled={busy}>계정 만들기</button></div>
    </form>
  );
}

function DisableDialog({ user, heirs, close, onDone }: {
  user: User; heirs: User[]; close: () => void; onDone: (msg: string) => void;
}) {
  const [to, setTo] = useState(heirs[0] ? String(heirs[0].id) : "");
  const [busy, run] = useBusy();
  const ok = async () => {
    const r = await run(() => api<{ moved: { customers: number; listings: number; deals: number } }>(
      "POST", `/admin/users/${user.id}/disable`, { transfer_to: Number(to) }));
    const heir = heirs.find((h) => String(h.id) === to);
    if (r) onDone(`${user.name} 계정을 정지했습니다. ${heir?.name}에게 고객 ${r.moved.customers}명, 매물 ${r.moved.listings}건, 진행 중 거래 ${r.moved.deals}건을 넘겼습니다.`);
  };
  return (
    <>
      <h2>{user.name} 계정 정지</h2>
      <p style={{ margin: "0 0 8px" }}>
        정지하면 바로 로그인할 수 없고, 담당 고객 {user.customers}명·매물 {user.listings}건·진행 중 거래 {user.deals}건을 아래 중개사에게 넘깁니다.
        고객 상담 기록에 인계 사실이 남습니다.
      </p>
      <label>넘겨받을 중개사
        <select id="heir" value={to} onChange={(e) => setTo(e.target.value)}>
          {heirs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.role === "admin" ? "관리자" : "중개사"})</option>)}
        </select>
      </label>
      <div className="btns">
        <button type="button" className="btn" data-act="close-dialog" onClick={close}>취소</button>
        <button type="button" className="btn btn--main" data-act="disable-ok" disabled={busy || !to} onClick={ok}>정지하고 넘기기</button>
      </div>
    </>
  );
}
