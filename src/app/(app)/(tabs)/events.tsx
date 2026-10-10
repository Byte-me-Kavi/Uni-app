import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';

import { TabIntro } from '@/components/tabs/tab-intro';

export default function Events() {
  return (
    <TabIntro
      title="Events"
      intro="Society events, hackathons and meetups at your university and beyond."
      Icon={CalendarBlankIcon}
      features={[
        {
          title: 'At your university',
          body: 'Events from your faculty, your societies and your batch.',
        },
        {
          title: 'Across universities',
          body: 'Hackathons, sports meets, debates and meetups open to students everywhere.',
        },
        {
          title: 'RSVP and add to calendar',
          body: 'Say you are going and get it in your phone calendar in one tap.',
        },
      ]}
    />
  );
}
