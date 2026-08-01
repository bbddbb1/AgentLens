import { ReplayControls } from '@/components/replay/ReplayControls';

export function StatusBar() {
  return (
    <div className="flex h-full items-center px-3">
      <ReplayControls />
    </div>
  );
}
