import type { Metadata } from "next";
import "./globals.css";
import { ToasterProvider } from "@/components/ui/Toaster";

export const metadata: Metadata = {
  title: "Anviksha AI",
  description: "AI-Powered Academic Intelligence Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ToasterProvider>{children}</ToasterProvider>
      </body>
    </html>
  );
}
