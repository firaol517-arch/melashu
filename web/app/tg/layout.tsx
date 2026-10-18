import Script from "next/script";
export const metadata = { title: "AI ጸሐፊ" };
export default function TgLayout({ children }: { children: React.ReactNode }) {
  return (<><Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />{children}</>);
}
