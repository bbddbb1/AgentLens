import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "AgentLens — Multi-Agent Review Platform",
  description:
    "Review, visualize, replay, and collaboratively govern multi-agent systems. GitHub PR + Datadog + Figma for AI agents.",
  keywords: [
    "multi-agent",
    "AI",
    "observability",
    "review",
    "OpenTelemetry",
    "LangGraph",
    "CrewAI",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
