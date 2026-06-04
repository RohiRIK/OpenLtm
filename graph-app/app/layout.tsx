import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import AppShell from "@/components/shell/AppShell";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "OpenLTM",
  description: "Long-term memory observability",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${jakarta.variable}`} suppressHydrationWarning>
      <body className="h-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <ThemeProvider 
          attribute="class" 
          defaultTheme="studio" 
          themes={["studio", "midnight", "forest", "concrete", "wine", "ocean"]} 
          enableSystem={false}
        >
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
