import { StorefrontIcon } from 'phosphor-react-native/src/icons/Storefront';

import { TabIntro } from '@/components/tabs/tab-intro';

// Not built yet: a student shop for batch merch and second-hand essentials.
export default function Shop() {
  return (
    <TabIntro
      title="Shop"
      intro="Calculators, batch T-shirts and more, sold by students, batches and societies."
      Icon={StorefrontIcon}
      features={[
        {
          title: 'Batch and society merch',
          body: 'Batch T-shirts, hoodies and society items, listed by batch reps, societies and the Uni Era team.',
        },
        {
          title: 'From students',
          body: 'Second-hand calculators, lab coats, drafters and books from students at your university.',
        },
        {
          title: 'Safe buying',
          body: 'Meet on campus and pay when you collect. Sellers are verified students.',
        },
      ]}
    />
  );
}
