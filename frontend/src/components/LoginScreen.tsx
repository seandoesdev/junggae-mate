/* 로그인. 예전과 같은 id(login-email, login-password, login-btn, login-error)를 쓴다 */
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/Icons";
import { DUR, EASE_OUT } from "@/lib/motion";
import { useSession } from "@/state/session";

export function LoginScreen() {
  const { login } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setBusy(true);
    try {
      await login(String(f.get("email") || "").trim(), String(f.get("password") || ""));
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="login-screen" className="login">
      <motion.form
        id="login-form"
        className="login-box"
        noValidate
        onSubmit={submit}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.slow, ease: EASE_OUT }}
      >
        <h1><BrandMark />중개메이트</h1>
        <label>이메일<input id="login-email" name="email" type="email" autoComplete="username" defaultValue="agent@hanul.test" required /></label>
        <label>비밀번호<input id="login-password" name="password" type="password" autoComplete="current-password" required /></label>
        {error && (
          <motion.p id="login-error" className="login-error" role="alert"
            initial={{ opacity: 0 }} animate={{ opacity: 1, x: [-4, 3, 0] }} transition={{ duration: DUR.slow }}>
            {error}
          </motion.p>
        )}
        <button id="login-btn" type="submit" className="btn btn--main" disabled={busy}>로그인</button>
        <p className="login-hint">예시 계정: agent@hanul.test / demo1234 (같은 사무소: park@, lee@, admin@hanul.test)</p>
      </motion.form>
    </main>
  );
}
