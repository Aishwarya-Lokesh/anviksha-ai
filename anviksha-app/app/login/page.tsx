"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, LogIn, ArrowLeft } from "lucide-react";
import { api, setAuth, SERVER_WAKING_EVENT } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  student: "Student", teacher: "Teacher", hod: "Head of Department", admin: "Admin",
};

function LoginForm() {
  const params = useSearchParams();
  const selectedRole = params.get("role") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [waking, setWaking] = useState(false);
  const router = useRouter();
  const sessionExpired = params.get("expired") === "1";

  useEffect(() => {
    const onWaking = (e: Event) => setWaking(Boolean((e as CustomEvent).detail));
    window.addEventListener(SERVER_WAKING_EVENT, onWaking);
    return () => window.removeEventListener(SERVER_WAKING_EVENT, onWaking);
  }, []);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.login(email, password);
      if (selectedRole && res.role !== selectedRole) {
        setError(`These credentials belong to a ${ROLE_LABELS[res.role] || res.role} account, not ${ROLE_LABELS[selectedRole] || selectedRole}. Go back and pick the right role, or use the correct login.`);
        setLoading(false);
        return;
      }
      setAuth(res.access_token, res.role);
      router.push(`/${res.role}`);
    } catch (e: any) {
      const message = e?.message || "";
      if (/failed: 401/.test(message)) setError("Incorrect email or password.");
      else if (/Unable to connect/i.test(message)) setError("We couldn't reach the server. Check your connection and try again.");
      else setError("Something went wrong on our side. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-navy via-navy-light to-[#241a5e] flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <button onClick={() => router.push("/")} className="flex items-center gap-1 text-xs text-muted hover:text-ink mb-4 transition-colors">
          <ArrowLeft size={13} /> Choose a different role
        </button>
        <div className="flex items-center gap-2.5 mb-2 justify-center">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-display font-extrabold text-ink">ANVIKSHA AI</h1>
        </div>
        {selectedRole && (
          <p className="text-center text-xs text-brand font-semibold mb-6">
            Signing in as {ROLE_LABELS[selectedRole] || selectedRole}
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label htmlFor="login-email" className="text-xs font-medium text-muted mb-1 block">Email</label>
            <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your.login@anviksha.ai" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs font-medium text-muted mb-1 block">Password</label>
            <input id="login-password" autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          {sessionExpired && !error && !loading && (
            <p className="text-xs text-muted">Your session ended. Please sign in again.</p>
          )}
          {loading && waking && (
            <p role="status" className="text-xs text-muted">
              Starting the server — this can take up to a minute after a quiet period. Please keep this page open.
            </p>
          )}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button onClick={submit} disabled={loading} className="w-full bg-brand text-white font-semibold min-h-[44px] rounded-xl hover:bg-brand-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2 mt-2">
            <LogIn size={15} /> {loading ? (waking ? "Starting server..." : "Signing in...") : "Sign In"}
          </button>
        </div>
      </motion.div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
