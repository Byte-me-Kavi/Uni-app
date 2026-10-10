-- Local development data only. `supabase db reset` loads this after the migrations.
-- Real institutions are added through the admin dashboard, never through this file.
--
-- To try the full flow locally:
--   1. Sign up in the app with any address @student.test (codes arrive at http://127.0.0.1:54324).
--   2. Make yourself an admin (replace the email), using `supabase db query` or Studio's SQL editor:
--        update identity.profiles set account_status = 'active'
--          where user_id = (select id from auth.users where email = 'you@student.test');
--        insert into identity.staff_roles (user_id, role)
--          select id, 'admin' from auth.users where email = 'you@student.test';
--   3. Sign up a second student and approve them with api.review_account.

insert into identity.institutions (name, short_name, kind, status) values
  ('Uni Era Test University', 'GTU', 'state', 'live'),
  ('Uni Era Waitlist University', 'GWU', 'state', 'waitlist');

insert into identity.institution_email_domains (domain, institution_id)
select 'student.test', id from identity.institutions where short_name = 'GTU'
union all
select 'waitlist.test', id from identity.institutions where short_name = 'GWU';

insert into academics.faculties (institution_id, name)
select id, f.name
from identity.institutions, (values ('Faculty of Science'), ('Faculty of Engineering')) as f (name)
where short_name = 'GTU';

insert into academics.programmes (institution_id, faculty_id, name)
select f.institution_id, f.id, p.name
from academics.faculties f
join (values
  ('Faculty of Science', 'BSc in Computer Science'),
  ('Faculty of Science', 'BSc in Physical Science'),
  ('Faculty of Engineering', 'BSc Eng in Computer Engineering')
) as p (faculty, name) on p.faculty = f.name;

insert into academics.cohorts (programme_id, intake_year, expected_size)
select id, y, 150 from academics.programmes, generate_series(2023, 2026) as y;

insert into academics.subjects (name) values ('Data Structures'), ('Calculus'), ('Digital Logic');

insert into academics.modules (institution_id, code, name, subject_id)
select i.id, m.code, m.name, s.id
from identity.institutions i
cross join (values
  ('CS1012', 'Data Structures and Algorithms', 'Data Structures'),
  ('MA1013', 'Calculus I', 'Calculus'),
  ('CE1021', 'Digital Logic Design', 'Digital Logic')
) as m (code, name, subject)
join academics.subjects s on s.name = m.subject
where i.short_name = 'GTU';
