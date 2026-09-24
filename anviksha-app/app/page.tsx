"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { GraduationCap, UserCog, Users, Sparkles, Briefcase } from "lucide-react";

const roles = [
  { key: "student", label: "Student", desc: "Track academics, attendance, and build your resume", icon: GraduationCap },
  { key: "teacher", label: "Teacher", desc: "Manage students, attendance, and generate papers", icon: Users },
  { key: "hod", label: "Head of Department", desc: "Department-wide oversight and analytics", icon: Briefcase },
  { key: "admin", label: "Admin", desc: "Institute-wide oversight and reporting", icon: UserCog },
];

export default function Home() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-gradient-to-br from-navy via-navy-light to-[#241a5e] flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-3"
      >
        <div className="w-12 h-12 rounded-2xl bg-brand flex items-center justify-center">
          <Sparkles size={24} className="text-white" />
        </div>
        <h1 className="text-3xl font-display font-extrabold text-white">ANVIKSHA AI</h1>
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-white/60 mb-12 text-sm"
      >
        AI-Powered Academic Intelligence Platform — choose a role, then log in to continue
      </motion.p>

      <div className="grid md:grid-cols-4 gap-5 w-full max-w-5xl">
        {roles.map((r, i) => {
          const Icon = r.icon;
          return (
            <motion.div
              key={r.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }}
              whileHover={{ y: -6 }}
              onClick={() => router.push(`/login?role=${r.key}`)}
              className="cursor-pointer"
            >
              <div className="bg-white/5 border border-white/10 hover:border-brand/60 hover:bg-white/10 rounded-2xl p-7 h-full transition-colors">
                <div className="w-12 h-12 rounded-xl bg-brand/20 flex items-center justify-center mb-4">
                  <Icon size={24} style={{ color: "#8B7CF6" }} />
                </div>
                <h3 className="text-white font-semibold text-lg mb-1.5">{r.label}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{r.desc}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </main>
  );
}
