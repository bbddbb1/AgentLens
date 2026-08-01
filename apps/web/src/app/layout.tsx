import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'AgentLens — Runtime Debugger',
  description: 'Inspect, replay, and govern autonomous agent execution from recorded runtime evidence.',
  keywords: ['agent runtime', 'runtime debugger', 'observability', 'replay', 'governance', 'provenance', 'OpenTelemetry'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
