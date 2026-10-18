import { Inter } from 'next/font/google';
import './globals.css';
const inter = Inter({ subsets: ['latin'] });
export const metadata = { title: 'Facet AI', description: 'See your face. Fix what matters.' };
export const viewport = { width: 'device-width', initialScale: 1 };
export default function Root({ children }) {
  return <html lang="en"><body className={inter.className} suppressHydrationWarning>{children}</body></html>;
}
