"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Sparkles, BarChart3, Settings } from "lucide-react";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/secretary", label: "Secretary", icon: Sparkles, fab: true },
  { href: "/analytics", label: "Progress", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Nav() {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ivory/95 backdrop-blur">
      <ul className="mx-auto grid max-w-2xl grid-cols-5 items-end px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
        {items.map(({ href, label, icon: Icon, fab }) => (
          <li key={href} className="flex justify-center">
            <Link href={href} aria-current={active(href) ? "page" : undefined}
              className={fab ? "-mt-8 flex flex-col items-center gap-1" : "flex flex-col items-center gap-1 px-2 py-1"}>
              {fab ? (
                <span className="grid h-16 w-16 place-items-center rounded-full bg-forest text-cream shadow-lg"><Icon size={28} /></span>
              ) : (
                <Icon size={24} className={active(href) ? "text-forest" : "text-sage"} />
              )}
              <span className={`text-xs ${active(href) ? "font-semibold text-forest" : "text-sage"}`}>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
