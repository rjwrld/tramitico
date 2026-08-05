import { Chat } from "@/components/chat/chat";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="font-serif text-xl font-semibold tracking-tight">
          trami<span className="text-primary">tico</span>
        </span>
        <ThemeToggle />
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Chat />
      </main>
    </div>
  );
}
