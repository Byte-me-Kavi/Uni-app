import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  /** Which sides keep clear of the status bar, notch and home indicator. */
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
};

// Every screen's root. Applies safe-area padding from the useSafeAreaInsets hook rather than the
// SafeAreaView component: SafeAreaView re-measures while a screen animates, which made screens
// jump up by the status-bar height during transitions. React Navigation recommends the hook for
// exactly this reason (reactnavigation.org/docs/handling-safe-area). Do not mix the two.
export function Screen({ children, edges = ['top', 'bottom'], style }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: edges.includes('left') ? insets.left : 0,
          paddingRight: edges.includes('right') ? insets.right : 0,
        },
        style,
      ]}>
      {children}
    </View>
  );
}
