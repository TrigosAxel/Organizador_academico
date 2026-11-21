import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TEMA_CLARO_CSS } from "./temaClaro";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Los íconos de la pestaña salen solos de los archivos de esta carpeta:
// icon.png, apple-icon.png y favicon.ico (no hace falta declararlos acá).
export const metadata: Metadata = {
  title: "AulaTrack | Seguimiento de tu vida académica",
  description: "Gestioná tu carrera, horarios, asistencias, parciales y correlativas",
};

// Aplica el tema (claro / oscuro) y el tamaño de letra antes de que se dibuje la página,
// así no hay un destello oscuro al abrir la app. La configuración se guarda en este dispositivo.
const SCRIPT_TEMA = `(function(){try{var c=JSON.parse(localStorage.getItem('aulatrack_config')||'{}');var t=c.tema||'claro';var d=t==='oscuro'||(t==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var h=document.documentElement;if(!d)h.classList.add('tema-claro');var f={chica:'14px',normal:'16px',grande:'18px'}[c.fuente];if(f)h.style.fontSize=f;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: TEMA_CLARO_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}