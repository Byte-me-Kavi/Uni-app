// The community guidelines every student accepts at sign-up (consent purpose community_guidelines,
// version v1). Changing what they ask of students means a new version: bump GUIDELINES_VERSION here
// and identity.consent_purposes.current_version together, and students are asked again.
// Sinhala and Tamil follow with the translated app; a lawyer reviews the text before launch.

export const GUIDELINES_VERSION = 'v1';
export const GUIDELINES_DATE = 'October 2026';

export type GuidelineSection = { title: string; points: string[] };

export const GUIDELINES_INTRO =
  'Uni Era is for university students in Sri Lanka, run by a small team. These rules keep it a place where every student, from a fresher in their first week to a final-year student, feels safe. They apply in chats, posts, comments, the Shop, kuppi and everything else in the app.';

export const GUIDELINES: GuidelineSection[] = [
  {
    title: 'Be yourself, once',
    points: [
      'Use one account, your own. Do not share it or sign up for someone else.',
      'You must be 18 or older.',
      'Do not pretend to be another student, a lecturer, a society or the Uni Era team.',
    ],
  },
  {
    title: 'No ragging, threats or violence',
    points: [
      'Ragging is a crime in Sri Lanka (Act No. 20 of 1998). Pressuring, humiliating, threatening or summoning freshers, in the app or because of it, is never allowed.',
      'No threats of violence against anyone, and nothing that encourages someone to hurt themselves.',
      'Freshers are protected: seniors reach them only through message requests they accept. Do not try to get around this.',
    ],
  },
  {
    title: 'Respect everyone',
    points: [
      'No hate or insults based on ethnicity, religion, caste, gender, sexual orientation, disability or where someone is from.',
      'No harassment or bullying, and no unwanted messages after someone says no or blocks you.',
      'No sexual content, and no sexual messages to anyone who has not clearly agreed.',
    ],
  },
  {
    title: 'Keep other people’s information private',
    points: [
      'Do not post anyone else’s phone number, address, NIC, photos or screenshots of their messages without their agreement.',
      'Tell everyone before you record a kuppi, and never share a recording people did not agree to.',
    ],
  },
  {
    title: 'Be honest when you buy, sell, rent or hire',
    points: [
      'Describe items, bodim places and jobs truthfully, with the real price.',
      'Never ask students to pay to get a job, a place or a prize. These are scams and are removed.',
      'Meet in safe, public places on campus when you can.',
    ],
  },
  {
    title: 'Study honestly',
    points: [
      'Share your own notes and papers you are allowed to share. Do not share leaked exam papers or answers.',
      'Respect copyright: do not upload whole textbooks or paid course material.',
    ],
  },
  {
    title: 'Keep it useful',
    points: [
      'No spam, chain messages, repeated posts or unrelated advertising.',
      'Political discussion is welcome in spaces made for it, with respect. No political ads.',
    ],
  },
  {
    title: 'If you see something',
    points: [
      'Report it: long-press a message, or use the menu on a post, profile or listing. The person is never told who reported them.',
      'Ragging, threats and self-harm go to the front of the queue, with a 2-hour target.',
      'If someone is in danger right now, call 119. Account, Get help lists your university’s anti-ragging contacts and helplines.',
    ],
  },
  {
    title: 'What happens if rules are broken',
    points: [
      'Depending on how serious it is: content removed, a warning, a mute (no sending or posting for a while), a suspension, or the account closed.',
      'You always see the reason, under Account, Your standing.',
      'You can appeal each action once, within 30 days. A different moderator decides.',
      'Evidence of a crime is shared with a university or the police only with the reporter’s agreement or a legal order.',
    ],
  },
];
