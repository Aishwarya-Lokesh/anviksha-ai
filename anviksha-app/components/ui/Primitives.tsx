"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import React from "react";

export function Card({
  children,
  className,
  hover = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn(
        "bg-white rounded-2xl border border-gray-100/80 shadow-card p-6",
        hover && "transition-all duration-500 ease-smooth hover:shadow-cardHover hover:-translate-y-[3px] hover:border-gray-100",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MotionCard({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className={cn(
        "bg-white rounded-2xl border border-gray-100/80 shadow-card hover:shadow-cardHover p-6 transition-shadow duration-500 ease-smooth",
        className
      )}
    >
      {children}
    </motion.div>
  );
}

type ButtonBaseProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonBaseProps & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-dark shadow-sm hover:shadow-md",
    secondary: "bg-brand-50 text-brand hover:bg-brand-light border border-brand/10",
    ghost: "bg-transparent text-ink hover:bg-gray-100/80",
    danger: "bg-danger/10 text-danger hover:bg-danger/15",
  };
  const sizes = {
    sm: "text-xs px-3 py-1.5",
    md: "text-sm px-4 py-2.5",
    lg: "text-base px-6 py-3",
  };
  return (
    <motion.button
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "success" | "warning" | "danger" | "info" | "neutral" | "brand";
  className?: string;
}) {
  const tones = {
    success: "bg-success/10 text-success ring-1 ring-inset ring-success/15",
    warning: "bg-warning/10 text-[#9c6b12] ring-1 ring-inset ring-warning/15",
    danger: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/15",
    info: "bg-info/10 text-info ring-1 ring-inset ring-info/15",
    neutral: "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200/60",
    brand: "bg-brand-50 text-brand ring-1 ring-inset ring-brand/15",
  };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tracking-tight", tones[tone], className)}>
      {children}
    </span>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold text-ink tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
