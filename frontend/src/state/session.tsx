/* 로그인 상태. 토큰이 있으면 /me로 사용자를 다시 불러온다. 401은 어디서 나든 로그아웃으로 이어진다. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken, setUnauthorizedHandler } from "@/lib/api";
import { LOGOUT_EVENT } from "@/lib/router";
import type { User } from "@/lib/types";

type Session = {
  user: User | null;
  /** 저장된 토큰으로 사용자를 불러오는 중 */
  booting: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(Boolean(getToken()));

  const queryClient = useQueryClient();
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    // 같은 탭에서 다음 사람이 로그인해도 앞 사람의 자료가 보이지 않게: 받아 둔 응답과 화면별 기억을 비운다
    queryClient.clear();
    dispatchEvent(new Event(LOGOUT_EVENT));
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api<User>("GET", "/me")
      .then(setUser)
      .catch(() => { /* 401이면 logout()이 이미 불렸다 */ })
      .finally(() => setBooting(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ access_token: string; user: User }>("POST", "/auth/login", { email, password });
    setToken(r.access_token);
    setUser(r.user);
  }, []);

  const value = useMemo(() => ({ user, booting, login, logout }), [user, booting, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider 밖에서 useSession을 불렀습니다.");
  return s;
}

/** 로그인한 사용자 (로그인 뒤 화면에서만 쓴다) */
export function useUser() {
  const { user } = useSession();
  if (!user) throw new Error("로그인 전입니다.");
  return user;
}
