import { ChatsCircleIcon } from 'phosphor-react-native/src/icons/ChatsCircle';

import { TabIntro } from '@/components/tabs/tab-intro';

export default function Chats() {
  return (
    <TabIntro
      title="Chats"
      intro="Talk to students at any university. Your batch and course groups live here too."
      Icon={ChatsCircleIcon}
      features={[
        {
          title: 'Direct messages',
          body: 'Message any verified student. Messages from people you have not met wait in Requests until you accept.',
        },
        {
          title: 'Batch and course groups',
          body: 'A group for your batch at your university and one for each module you take, joined automatically.',
        },
        {
          title: 'Your own groups',
          body: 'Start a group with friends, a project team or students from other universities.',
        },
      ]}
    />
  );
}
