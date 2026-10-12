import { memo } from 'react';
import { View } from 'react-native';

import { useModuleColour } from '@/lib/module-colours';

// A module's colour as a small dot, beside its name in lists.
export const ModuleDot = memo(function ModuleDot({ id, size = 10 }: { id: number; size?: number }) {
  const colour = useModuleColour(id);
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colour.fg }} />;
});
