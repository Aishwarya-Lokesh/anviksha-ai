"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, LogIn, ArrowLeft } from "lucide-react";
import { api, setAuth } from "@/lib/api";

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
  const router = useRouter();

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
      setError("Login failed — check your email/password, and that the backend server is running.");
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
            <label className="text-xs font-medium text-muted mb-1 block">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your.login@anviksha.ai" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button onClick={submit} disabled={loading} className="w-full bg-brand text-white font-semibold py-2.5 rounded-xl hover:bg-brand-dark transition-colors flex items-center justify-center gap-2 mt-2">
            <LogIn size={15} /> {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
        <p className="text-xs text-muted text-center mt-5">
          Backend must be running at <code className="bg-gray-100 px-1 rounded">127.0.0.1:8000</code>
        </p>
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
