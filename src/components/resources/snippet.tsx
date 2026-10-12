import { Text } from 'react-native';

import { createThemedStyles, fonts } from '@/theme/tokens';

// The line inside a file that matched a search, with the searched words (between « and », from
// the server) in bold.
export function Snippet({ text }: { text: string }) {
  const styles = useStyles();
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <Text style={styles.snippet} numberOfLines={2}>
      …
      {parts.map((part, i) =>
        part.startsWith('«') ? (
          <Text key={i} style={styles.hit}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
      …
    </Text>
  );
}

const useStyles = createThemedStyles((t) => ({
  snippet: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: t.textMuted },
  hit: { fontFamily: fonts.bodyBold, color: t.text },
}));
