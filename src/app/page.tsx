import { HeroCta } from "@/components/HeroCta";
import { PublicToolList } from "@/components/PublicToolList";

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-600 px-8 py-14 text-white">
        <p className="text-sm font-medium tracking-widest text-emerald-100 uppercase">LendLoop</p>
        <h1 className="mt-2 max-w-xl text-4xl font-semibold tracking-tight">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="mt-3 max-w-lg text-emerald-50">
          Your neighbors already own the drill, the ladder and the tent. LendLoop helps you share them,
          with requests, approvals and friendly reminders handled for you.
        </p>
        <div className="mt-6">
          <HeroCta />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Tools on the board</h2>
          <p className="text-sm text-stone-500">Sign in to see details and availability.</p>
        </div>
        <PublicToolList />
      </section>
    </div>
  );
}
