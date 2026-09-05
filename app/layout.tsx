import './globals.css';

export const metadata = {
  title: 'STD Line — ระบบมาตรฐานตำแหน่งบรรจุ',
  description: 'ระบบจัดการมาตรฐานตำแหน่งพนักงานบนสายพานบรรจุ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
