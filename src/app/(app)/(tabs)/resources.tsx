import { BookOpenIcon } from 'phosphor-react-native/src/icons/BookOpen';

import { TabIntro } from '@/components/tabs/tab-intro';

// Study in one place: shared notes and papers, and kuppi (peer tutoring) sessions.
export default function Resources() {
  return (
    <TabIntro
      title="Resources"
      intro="Notes, past papers and kuppi, shared by students at every university."
      Icon={BookOpenIcon}
      features={[
        {
          title: 'Notes and past papers',
          body: 'Browse by university and module, starting with the modules you take. Save files to study offline.',
        },
        {
          title: 'Search across universities',
          body: 'Find material by subject, so a Data Structures note from one campus helps students at another.',
        },
        {
          title: 'Kuppi sessions',
          body: 'Join peer tutoring for your modules on Zoom, Meet or Teams, or host one on a topic you know well.',
        },
      ]}
    />
  );
}
