import { AtlasPanel } from '@/components/AtlasPanel';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function AtlasPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token');

  if (!token?.value) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Atlas Self-Improvement</h1>
          <p className="text-slate-300">
            Weekly reflection on the agent fleet → learned coordination rules → tested &amp; measured over time.
          </p>
        </div>

        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <AtlasPanel />
        </div>
      </div>
    </main>
  );
}
