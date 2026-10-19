import { useState } from 'react';
import { PlanEditor } from '../src/ui/PlanEditor';

export default function App() {
  const [planModalOpen, setPlanModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-xl font-semibold">PlanManager UI Demo</h1>
        <p className="mt-1 text-sm text-slate-400">Демо для отладки редактора плана</p>
      </header>

      {/* Main content */}
      <main className="flex items-center justify-center p-8">
        <div className="text-center">
          <button
            onClick={() => setPlanModalOpen(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Открыть редактор плана
          </button>
        </div>
      </main>

      {/* Plan Editor Modal */}
      <PlanEditor
        planId="demo-plan"
        isOpen={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
      />
    </div>
  );
}
