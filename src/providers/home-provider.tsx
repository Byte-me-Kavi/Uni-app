import { createContext, use, type ReactNode } from 'react';

import { useHome } from '@/lib/use-home';

type HomeData = ReturnType<typeof useHome>;

const HomeContext = createContext<HomeData | null>(null);

// Loads the signed-in user's home data once, in the tabs layout, so the persistent header (avatar)
// and the Home tab share one request instead of each fetching it.
export function HomeProvider({ children }: { children: ReactNode }) {
  const home = useHome();
  return <HomeContext value={home}>{children}</HomeContext>;
}

export function useHomeData(): HomeData {
  const value = use(HomeContext);
  if (!value) throw new Error('useHomeData must be used inside HomeProvider');
  return value;
}
