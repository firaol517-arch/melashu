import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusiness } from "@/lib/session";
import ChatPanel from "@/components/ChatPanel";
export const dynamic = "force-dynamic";

export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireBusiness();
  const { data: conv } = await supabase.from("sec_conversations").select("*, customer:sec_customers(display_name,username)").eq("id", id).maybeSingle(); // RLS-scoped
  if (!conv) notFound();
  const { data: msgs } = await supabase.from("sec_messages").select("id,direction,sender,body,status,error,created_at").eq("conversation_id", id).order("created_at").limit(300);
  const c: any = conv;
  return (<div className="space-y-4"><Link href="/chats" className="text-sm text-sage">← Inbox</Link>
    <h2 className="font-display text-3xl">{c.customer?.display_name || "Unknown"}{c.customer?.username && <span className="ml-2 text-base text-sage">@{c.customer.username}</span>}</h2>
    <ChatPanel conv={c} messages={msgs ?? []} name={c.customer?.display_name || "customer"} /></div>);
}
