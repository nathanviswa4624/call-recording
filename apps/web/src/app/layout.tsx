import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const PRODUCT = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Echelons Call Recording';

export const metadata: Metadata = {
  title: { default: PRODUCT, template: `%s · ${PRODUCT}` },
  description: 'Call recording, SIP trunk and Asterisk management',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Apply the saved theme before paint to avoid a flash (no secrets involved).
const themeScript = `try{var t=localStorage.getItem('ech.theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
