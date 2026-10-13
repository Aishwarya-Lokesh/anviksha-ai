import type { Metadata } from "next";
import "./globals.css";
import { ToasterProvider } from "@/components/ui/Toaster";

export const metadata: Metadata = {
  title: "Anviksha AI",
  description: "AI-Powered Academic Intelligence Platform",
};

const THEME_SCRIPT = `try{if(localStorage.getItem("anviksha_theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before the first paint, so a dark-mode visitor never sees a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ToasterProvider>{children}</ToasterProvider>
      </body>
    </html>
  );
}
