-- Academics: faculties, programmes, cohorts (batches), national subjects, modules and enrolments.

create table academics.faculties (
  id bigint generated always as identity primary key,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  unique (institution_id, name)
);

create table academics.programmes (
  id bigint generated always as identity primary key,
  faculty_id bigint not null references academics.faculties (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  unique (faculty_id, name)
);

-- A batch: one programme's intake in one academic year.
create table academics.cohorts (
  id bigint generated always as identity primary key,
  programme_id bigint not null references academics.programmes (id) on delete cascade,
  intake_year smallint not null check (intake_year between 2000 and 2100),
  -- Published UGC intake for this programme; used to pause joins that look suspicious.
  expected_size integer check (expected_size > 0),
  unique (programme_id, intake_year)
);

-- MVP rule: a student belongs to one batch.
create table academics.cohort_members (
  user_id uuid primary key references identity.profiles (user_id) on delete cascade,
  cohort_id bigint not null references academics.cohorts (id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index cohort_members_cohort_idx on academics.cohort_members (cohort_id, joined_at);

-- National subject index, so a module at one university can be found from another.
create table academics.subjects (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 2 and 120)
);

create table academics.modules (
  id bigint generated always as identity primary key,
  institution_id bigint not null references identity.institutions (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9 _./-]{2,20}$'),
  name text not null check (char_length(name) between 2 and 200),
  subject_id bigint references academics.subjects (id) on delete set null,
  unique (institution_id, code)
);
create index modules_subject_idx on academics.modules (subject_id);
create index modules_name_trgm_idx on academics.modules using gin (name extensions.gin_trgm_ops);

-- Which programmes teach which module, and in which year of study.
create table academics.programme_modules (
  programme_id bigint not null references academics.programmes (id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  year_of_study smallint not null check (year_of_study between 1 and 7),
  primary key (programme_id, module_id)
);
create index programme_modules_module_idx on academics.programme_modules (module_id);

-- "My modules": drives course chats, the home feed and resource suggestions.
create table academics.module_enrolments (
  user_id uuid not null default auth.uid() references identity.profiles (user_id) on delete cascade,
  module_id bigint not null references academics.modules (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (user_id, module_id)
);
create index module_enrolments_module_idx on academics.module_enrolments (module_id);

alter table academics.faculties enable row level security;
alter table academics.programmes enable row level security;
alter table academics.cohorts enable row level security;
alter table academics.cohort_members enable row level security;
alter table academics.subjects enable row level security;
alter table academics.modules enable row level security;
alter table academics.programme_modules enable row level security;
alter table academics.module_enrolments enable row level security;

-- Reference data is not personal; signed-in users (including pending ones, for onboarding) can read it.
grant select on academics.faculties, academics.programmes, academics.cohorts, academics.subjects,
  academics.modules, academics.programme_modules to authenticated;
create policy "read faculties" on academics.faculties for select to authenticated using (true);
create policy "read programmes" on academics.programmes for select to authenticated using (true);
create policy "read cohorts" on academics.cohorts for select to authenticated using (true);
create policy "read subjects" on academics.subjects for select to authenticated using (true);
create policy "read modules" on academics.modules for select to authenticated using (true);
create policy "read programme modules" on academics.programme_modules for select to authenticated using (true);

-- Membership rows: only your own. Batch directories come later through api functions that apply
-- each member's privacy settings.
grant select on academics.cohort_members, academics.module_enrolments to authenticated;
grant insert (module_id), delete on academics.module_enrolments to authenticated;
create policy "own cohort membership" on academics.cohort_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own enrolments: read" on academics.module_enrolments
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own enrolments: add" on academics.module_enrolments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from academics.modules m
      where m.id = module_id and m.institution_id = (select identity.current_institution_id())
    )
  );
create policy "own enrolments: remove" on academics.module_enrolments
  for delete to authenticated using (user_id = (select auth.uid()));
