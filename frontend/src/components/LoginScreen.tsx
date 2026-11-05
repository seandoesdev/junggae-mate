/* 로그인과 회원가입(새 사무소 만들기).
   로그인은 예전과 같은 id(login-email, login-password, login-btn, login-error)를 쓴다.
   회원가입하면 그 사무소의 관리자가 되고 바로 로그인된다. 같은 사무소 동료 계정은 관리자가 따로 만든다. */
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/Icons";
import { ApiError } from "@/lib/api";
import { DUR, EASE_OUT } from "@/lib/motion";
import { useSession } from "@/state/session";

type Mode = "login" | "signup";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const text = (f: FormData, k: string) => String(f.get(k) || "").trim();

/** 서버 오류를 사람이 읽을 문장으로 (입력 검증 오류는 영어라 일반 문장으로 바꾼다) */
function message(ex: unknown): string {
  if (ex instanceof ApiError) {
    if (ex.status === 422) return "입력한 내용을 다시 확인해 주세요.";
    return ex.message;
  }
  // fetch 자체가 실패: 서버에 닿지 못함 (주소·네트워크·인증서·CORS)
  if (ex instanceof TypeError) return "서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 관리자에게 알려 주세요.";
  return (ex as Error).message || "요청을 처리하지 못했습니다.";
}

export function LoginScreen() {
  const { login, signup } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTo = (m: Mode) => { setMode(m); setError(null); };

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await fn(); }
    catch (ex) { setError(message(ex)); }
    finally { setBusy(false); }
  }

  function submitLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = text(f, "email"), password = String(f.get("password") || "");
    if (!email || !password) { setError("이메일과 비밀번호를 입력해 주세요."); return; }
    void run(() => login(email, password));
  }

  function submitSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const office_name = text(f, "office_name"), name = text(f, "name"), email = text(f, "email");
    const password = String(f.get("password") || ""), password2 = String(f.get("password2") || "");
    if (office_name.length < 2) return setError("사무소 이름을 2자 이상 입력해 주세요.");
    if (!name) return setError("이름을 입력해 주세요.");
    if (!EMAIL.test(email)) return setError("이메일 형식이 올바르지 않습니다.");
    if (password.length < 8) return setError("비밀번호는 8자 이상으로 정해 주세요.");
    if (password !== password2) return setError("비밀번호 확인이 일치하지 않습니다.");
    void run(() => signup({ office_name, name, email, password }));
  }

  const errorEl = error && (
    <motion.p id="login-error" className="login-error" role="alert"
      initial={{ opacity: 0 }} animate={{ opacity: 1, x: [-4, 3, 0] }} transition={{ duration: DUR.slow }}>
      {error}
    </motion.p>
  );

  return (
    <main id="login-screen" className="login">
      <AnimatePresence mode="wait" initial={false}>
        {mode === "login" ? (
          <motion.form
            key="login"
            id="login-form"
            className="login-box"
            noValidate
            onSubmit={submitLogin}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            <h1><BrandMark />중개메이트</h1>
            <label>이메일<input id="login-email" name="email" type="email" autoComplete="username" required autoFocus /></label>
            <label>비밀번호<input id="login-password" name="password" type="password" autoComplete="current-password" required /></label>
            {errorEl}
            <button id="login-btn" type="submit" className="btn btn--main" disabled={busy}>로그인</button>
            <p className="login-hint">
              처음이신가요?{" "}
              <button type="button" className="linkbtn" data-act="to-signup" onClick={() => switchTo("signup")}>회원가입</button>
            </p>
          </motion.form>
        ) : (
          <motion.form
            key="signup"
            id="signup-form"
            className="login-box"
            noValidate
            onSubmit={submitSignup}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            <h1><BrandMark />회원가입</h1>
            <p className="login-hint" style={{ marginTop: -8 }}>새 사무소를 만들고, 가입한 분이 그 사무소의 관리자가 됩니다.</p>
            <label>사무소 이름<input id="signup-office" name="office_name" autoComplete="organization" maxLength={60} required autoFocus /></label>
            <label>이름<input id="signup-name" name="name" autoComplete="name" maxLength={40} required /></label>
            <label>이메일<input id="signup-email" name="email" type="email" autoComplete="email" maxLength={254} required /></label>
            <label>비밀번호 (8자 이상)<input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
            <label>비밀번호 확인<input id="signup-password2" name="password2" type="password" autoComplete="new-password" required /></label>
            {errorEl}
            <button id="signup-btn" type="submit" className="btn btn--main" disabled={busy}>가입하고 시작하기</button>
            <p className="login-hint">
              이미 계정이 있나요?{" "}
              <button type="button" className="linkbtn" data-act="to-login" onClick={() => switchTo("login")}>로그인</button>
            </p>
          </motion.form>
        )}
      </AnimatePresence>
    </main>
  );
}
